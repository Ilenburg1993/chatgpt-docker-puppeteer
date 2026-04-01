// @ts-check
/**
 * src/copilot/tools/file-tools.js
 *
 * Custom Tools de acesso ao filesystem para o agente LLM-B. Permite ler, escrever, listar, buscar, criar, deletar,
 * copiar e mover arquivos — com restrições de segurança embutidas.
 *
 * Restrições:
 *
 * - Operações de leitura/listagem/busca: skipPermission: true (não modificam estado)
 * - Operações de escrita/criação/deleção/cópia/movimentação: requirePermission (aprovação explícita)
 * - Caminhos restritos: apenas dentro de /workspaces/ e caminhos relativos ao workspace
 * - Arquivos bloqueados: .env, *.pem, *.key, _secret_, *.passwd, *.credentials
 * - Output de leitura truncado a MAX_CONTENT_BYTES para evitar overflow de contexto
 *
 * @module copilot/tools/file-tools
 */

import { log } from '#core/logger';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { buildTool, withSkipPermission } from './tool-factory.js';

const execFileAsync = promisify(execFile);

/** Raiz do workspace derivada do meta.url (resolve para /workspaces/...) */
const WORKSPACE_ROOT = new URL('../../..', import.meta.url).pathname;

/** Limite máximo de bytes retornados por read_file_content */
const MAX_CONTENT_BYTES = 80_000;

// MELHORIA-10 (fix): verificação lazy da disponibilidade de ripgrep (cache single-check)
/** @type {boolean | null} */
let _rgAvailable = null;

/**
 * Verifica se o binário `rg` (ripgrep) está disponível no PATH. O resultado é cacheado após a primeira verificação.
 *
 * @returns {Promise<boolean>}
 */
async function isRgAvailable() {
    if (_rgAvailable !== null) return _rgAvailable;
    try {
        await execFileAsync('rg', ['--version'], { timeout: 3000 });
        _rgAvailable = true;
    } catch {
        _rgAvailable = false;
        log('WARN', '[copilot/file-tools] ripgrep (rg) não encontrado no PATH — search_in_files retornará erro.');
    }
    return _rgAvailable;
}

/** Limite máximo de bytes retornados por search_in_file */
const MAX_SEARCH_OUTPUT = 20_000;

/** Limite máximo de entradas retornadas por list_directory */
const MAX_LIST_ENTRIES = 500;

/**
 * Padrões de arquivos bloqueados para TODAS as operações (segredos, chaves, credenciais).
 *
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS_SECRETS = [
    /\.env$/i,
    /\.env\./i,
    /\.pem$/i,
    /\.key$/i,
    /secret/i,
    /\.passwd$/i,
    /credentials/i,
    /\.pfx$/i,
    /\.p12$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.npmrc$/i,
    /\.netrc$/i,
];

/**
 * Padrões adicionais bloqueados apenas para operações de ESCRITA (executáveis que não devem ser criados/sobrescritos).
 *
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS_WRITE_ONLY = [
    // SEC-04 (fix): extensões executáveis que não devem ser criadas/sobrescritas via file-tools
    /\.exe$/i,
    /\.bat$/i,
    /\.cmd$/i,
    /\.sh$/i,
    /\.ps1$/i,
    /\.msi$/i,
    /\.dll$/i,
    /\.so$/i,
    /\.dylib$/i,
];

/**
 * Todos os padrões bloqueados (secrets + executáveis) — para operações de escrita.
 *
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS = [...BLOCKED_PATTERNS_SECRETS, ...BLOCKED_PATTERNS_WRITE_ONLY];

/**
 * Verifica se um caminho está dentro do workspace autorizado e não é um arquivo bloqueado.
 *
 * @param {string} filePath - Caminho absoluto ou relativo
 * @param {{ mode?: 'read' | 'write' }} [opts] - Modo de operação (default: 'write' para máxima proteção)
 * @returns {Promise<{ ok: boolean; reason?: string; resolved: string }>}
 */
async function validatePath(filePath, opts) {
    const mode = opts?.mode ?? 'write';
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);

    // SEC-04 / BUG-H06 (fix): resolver symlinks antes de verificar containment.
    // F3.4 (BUG-MOD-08): usar realpath assíncrono para não bloquear o event loop.
    // Quando o arquivo ainda não existe, resolve o diretório pai para evitar symlink traversal via parent.
    let realResolved = resolved;
    try {
        realResolved = await fs.promises.realpath(resolved);
    } catch {
        // Arquivo não existe ainda — resolver o diretório pai (que deve existir)
        try {
            const parentDir = await fs.promises.realpath(path.dirname(resolved));
            realResolved = path.join(parentDir, path.basename(resolved));
        } catch {
            // Diretório pai também não existe; usar o caminho resolvido normalmente
        }
    }

    const relativeToWorkspace = path.relative(WORKSPACE_ROOT, realResolved);

    // Impede traversal fora do workspace
    if (relativeToWorkspace.startsWith('..')) {
        return { ok: false, reason: `Acesso negado: caminho fora do workspace (${realResolved})`, resolved };
    }

    // Impede acesso a arquivos bloqueados
    // BUG-P2-08: leitura usa apenas padrões de secrets; escrita usa todos
    const patterns = mode === 'read' ? BLOCKED_PATTERNS_SECRETS : BLOCKED_PATTERNS;
    const basename = path.basename(resolved);
    for (const pattern of patterns) {
        if (pattern.test(basename)) {
            return { ok: false, reason: `Acesso negado: arquivo protegido (${basename})`, resolved };
        }
    }

    return { ok: true, resolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPERAÇÕES DE LEITURA (skipPermission: true)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: read_file_content — lê o conteúdo de um arquivo.
 */
const readFileContentTool = buildTool({
    name: 'read_file_content',
    description:
        'Lê o conteúdo de um arquivo no workspace. Arquivos de texto são retornados como string. ' +
        'Arquivos binários retornam uma indicação de tipo. Output limitado a 80KB.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (relativo ao workspace ou absoluto dentro de /workspaces/)'),
        startLine: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Linha inicial (1-based). Se omitido, lê desde o início.'),
        endLine: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Linha final (1-based, inclusivo). Se omitido, lê até o fim.'),
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            .describe('Codificação de saída. Use base64 para arquivos binários.'),
    }),
    handler: async ({ path: filePath, startLine, endLine, encoding }) => {
        const { ok, reason, resolved } = await validatePath(filePath, { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/read_file_content] ${resolved}`);

        try {
            const stats = fs.statSync(resolved);
            if (stats.isDirectory()) return { success: false, error: 'É um diretório, use list_directory.' };

            // UPG-N10/BUG-N12 (fix): usar streaming para evitar carregar arquivos grandes em memória
            if (encoding === 'base64') {
                const chunks = /** @type {Buffer[]} */ ([]);
                await new Promise((resolve, reject) => {
                    const stream = fs.createReadStream(resolved, { end: MAX_CONTENT_BYTES - 1 });
                    stream.on('data', (chunk) => chunks.push(/** @type {Buffer} */ (chunk)));
                    stream.on('end', resolve);
                    stream.on('error', reject);
                });
                const raw = Buffer.concat(chunks);
                return {
                    success: true,
                    path: resolved,
                    size: stats.size,
                    encoding: 'base64',
                    content: raw.toString('base64'),
                    truncated: stats.size > MAX_CONTENT_BYTES,
                };
            }

            const textChunks = /** @type {Buffer[]} */ ([]);
            await new Promise((resolve, reject) => {
                const stream = fs.createReadStream(resolved, { end: MAX_CONTENT_BYTES * 3 - 1 });
                stream.on('data', (chunk) => textChunks.push(/** @type {Buffer} */ (chunk)));
                stream.on('end', resolve);
                stream.on('error', reject);
            });
            const text = Buffer.concat(textChunks).toString('utf8');
            const lines = text.split('\n');
            const total = lines.length;

            const s = (startLine ?? 1) - 1;
            const e = endLine ?? total;
            const slice = lines.slice(s, e).join('\n');
            const truncated = slice.length > MAX_CONTENT_BYTES;

            return {
                success: true,
                path: resolved,
                size: stats.size,
                totalLines: total,
                returnedLines: { start: s + 1, end: Math.min(e, total) },
                content: truncated ? slice.slice(0, MAX_CONTENT_BYTES) + '\n[... conteúdo truncado ...]' : slice,
                truncated,
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: list_directory — lista o conteúdo de um diretório.
 */
const listDirectoryTool = buildTool({
    name: 'list_directory',
    description:
        'Lista o conteúdo de um diretório no workspace. Retorna nome, tipo (file/dir) e tamanho. ' +
        'Opcionalmente recursivo com limite de profundidade.',
    parameters: z.object({
        path: z.string().describe('Caminho do diretório (relativo ao workspace ou absoluto)'),
        recursive: z.boolean().optional().default(false).describe('Se true, lista recursivamente'),
        depth: z
            .number()
            .int()
            .min(1)
            .max(8)
            .optional()
            .default(3)
            .describe('Profundidade máxima para listagem recursiva (1-8)'),
        showHidden: z.boolean().optional().default(false).describe('Incluir arquivos/diretórios ocultos (dotfiles)'),
        filter: z.string().optional().describe('Glob pattern para filtrar entradas (ex: *.js, *.md)'),
    }),
    handler: async ({ path: dirPath, recursive, depth, showHidden, filter }) => {
        const { ok, reason, resolved } = await validatePath(dirPath, { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/list_directory] ${resolved} (recursive=${recursive}, depth=${depth})`);

        /**
         * @typedef {object} DirEntry
         * @property {string} name
         * @property {string} type
         * @property {number} [size]
         * @property {string} path
         * @property {DirEntry[]} [children]
         */

        try {
            const stats = fs.statSync(resolved);
            if (!stats.isDirectory()) return { success: false, error: 'Não é um diretório, use read_file_content.' };

            /**
             * @param {string} dir
             * @param {number} currentDepth
             * @returns {DirEntry[]}
             */
            function readDir(dir, currentDepth) {
                /** @type {string[]} */
                let entries;
                try {
                    entries = fs.readdirSync(dir);
                } catch {
                    return [];
                }

                /** @type {DirEntry[]} */
                const result = [];
                for (const name of entries) {
                    if (!showHidden && name.startsWith('.')) continue;
                    if (filter) {
                        // simple glob: only support *.ext patterns
                        const globMatch = filter.startsWith('*.') ? name.endsWith(filter.slice(1)) : name === filter;
                        if (!globMatch && !fs.statSync(path.join(dir, name)).isDirectory()) continue;
                    }
                    if (result.length >= MAX_LIST_ENTRIES) break;

                    const full = path.join(dir, name);
                    const rel = path.relative(WORKSPACE_ROOT, full);
                    let entryStats;
                    try {
                        entryStats = fs.statSync(full);
                    } catch {
                        continue;
                    }
                    const isDir = entryStats.isDirectory();
                    /** @type {DirEntry} */
                    const entry = {
                        name,
                        type: isDir ? 'dir' : 'file',
                        path: rel,
                    };
                    if (!isDir) entry.size = entryStats.size;
                    if (isDir && recursive && currentDepth < (depth ?? 3)) {
                        entry.children = readDir(full, currentDepth + 1);
                    }
                    result.push(entry);
                }
                return result;
            }

            const entries = readDir(resolved, 1);
            return {
                success: true,
                path: resolved,
                count: entries.length,
                truncated: entries.length >= MAX_LIST_ENTRIES,
                entries,
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: search_in_files — busca texto/regex em arquivos do workspace.
 */
const searchInFilesTool = buildTool({
    name: 'search_in_files',
    description:
        'Busca texto ou regex em arquivos do workspace usando ripgrep (rg). ' +
        'Retorna correspondências com número de linha e contexto.',
    parameters: z.object({
        pattern: z.string().describe('Padrão de busca (texto literal ou regex)'),
        path: z.string().optional().default('.').describe('Diretório ou arquivo onde buscar (relativo ao workspace)'),
        isRegex: z.boolean().optional().default(false).describe('Se true, trata pattern como expressão regular'),
        caseSensitive: z.boolean().optional().default(false).describe('Busca sensível a maiúsculas'),
        includePattern: z.string().optional().describe('Filtro de arquivos a incluir (ex: *.js, *.ts)'),
        excludePattern: z.string().optional().describe('Filtro de arquivos a excluir (ex: node_modules, dist)'),
        contextLines: z
            .number()
            .int()
            .min(0)
            .max(10)
            .optional()
            .default(2)
            .describe('Linhas de contexto ao redor de cada match (0-10)'),
        maxResults: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .default(50)
            .describe('Número máximo de resultados (1-500)'),
    }),
    handler: async ({
        pattern,
        path: searchPath,
        isRegex,
        caseSensitive,
        includePattern,
        excludePattern,
        contextLines,
        maxResults,
    }) => {
        const { ok, reason, resolved } = await validatePath(searchPath ?? '.', { mode: 'read' });
        if (!ok) return { success: false, error: reason };

        // SEC-P2-02: limitar comprimento do pattern para evitar ReDoS
        if (pattern.length > 500) {
            return { success: false, error: 'Pattern muito longo (máximo 500 caracteres).' };
        }

        log('INFO', `[copilot/search_in_files] pattern="${pattern}" in ${resolved}`);

        // SEC-03 (fix): usar execFile com args array em vez de execSync com template string interpolada
        // Isso elimina a possibilidade de injeção via pattern, includePattern ou excludePattern
        const rgArgs = [
            '--color=never',
            '--no-heading',
            ...(isRegex ? [] : ['--fixed-strings']),
            ...(caseSensitive ? [] : ['--ignore-case']),
            `--context=${contextLines ?? 2}`,
            `--max-count=${maxResults ?? 50}`,
            ...(includePattern ? [`--glob=${includePattern}`] : []),
            ...(excludePattern ? [`--glob=!${excludePattern}`] : []),
            '--glob=!node_modules',
            '--glob=!.git',
            '--glob=!dist',
            '-e',
            pattern,
            resolved,
        ];

        try {
            // MELHORIA-10 (fix): verificar disponibilidade de rg antes de tentar executar
            if (!(await isRgAvailable())) {
                return { success: false, error: 'ripgrep (rg) não está disponível neste ambiente.' };
            }
            const { stdout, stderr: _stderr } = await execFileAsync('rg', rgArgs, {
                cwd: WORKSPACE_ROOT,
                timeout: 30000,
                maxBuffer: MAX_SEARCH_OUTPUT * 4,
            });
            // SEC-V05 fix: filtrar linhas que pareçam conter dados sensíveis (PEM, JWT, tokens)
            const SENSITIVE_LINE_RE = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
            const filteredOutput = stdout
                .split('\n')
                .filter((line) => !SENSITIVE_LINE_RE.test(line))
                .join('\n')
                .slice(0, MAX_SEARCH_OUTPUT);
            const output = filteredOutput;
            return {
                success: true,
                pattern,
                searchPath: resolved,
                output,
                truncated: stdout.length >= MAX_SEARCH_OUTPUT,
            };
        } catch (/** @type {any} */ err) {
            // exit code 1 = no matches (not an error for rg)
            if ((err.code === 1 || err.status === 1) && !err.stderr) {
                return { success: true, pattern, searchPath: resolved, output: '', matchCount: 0 };
            }
            return { success: false, error: err.stderr ?? err.message };
        }
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// OPERAÇÕES DE ESCRITA (requirePermission — aprovação obrigatória)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: write_file_content — escreve conteúdo em um arquivo existente.
 */
const writeFileContentTool = buildTool({
    name: 'write_file_content',
    description:
        'Escreve conteúdo em um arquivo existente no workspace. ' +
        '⚠️ REQUER APROVAÇÃO — sobrescreve conteúdo existente. Use create_file para arquivos novos.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (deve existir)'),
        content: z.string().describe('Novo conteúdo completo do arquivo'),
        encoding: z
            .enum(['utf8', 'base64'])
            .optional()
            .default('utf8')
            .describe('Codificação do conteúdo (utf8 para texto, base64 para binário)'),
    }),
    handler: async ({ path: filePath, content, encoding }) => {
        const { ok, reason, resolved } = await validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/write_file_content] ${resolved}`);

        try {
            if (!fs.existsSync(resolved)) {
                return { success: false, error: 'Arquivo não encontrado. Use create_file para criar um novo arquivo.' };
            }
            const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
            fs.writeFileSync(resolved, buf);
            return {
                success: true,
                path: resolved,
                bytesWritten: buf.length,
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: create_file — cria um novo arquivo com conteúdo opcional.
 */
const createFileTool = buildTool({
    name: 'create_file',
    description:
        'Cria um novo arquivo no workspace com conteúdo opcional. ' +
        '⚠️ REQUER APROVAÇÃO — o arquivo não deve existir previamente (use write_file_content para sobrescrever).',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a criar'),
        content: z.string().optional().default('').describe('Conteúdo inicial do arquivo'),
        createParentDirs: z
            .boolean()
            .optional()
            .default(true)
            .describe('Se true, cria diretórios intermediários se não existirem'),
        overwrite: z
            .boolean()
            .optional()
            .default(false)
            .describe('Se true, sobrescreve o arquivo se já existir (⚠️ destrutivo)'),
    }),
    handler: async ({ path: filePath, content, createParentDirs, overwrite }) => {
        const { ok, reason, resolved } = await validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/create_file] ${resolved}`);

        try {
            if (fs.existsSync(resolved) && !overwrite) {
                return {
                    success: false,
                    error: 'Arquivo já existe. Passe overwrite: true para sobrescrever ou use write_file_content.',
                };
            }
            if (createParentDirs) {
                fs.mkdirSync(path.dirname(resolved), { recursive: true });
            }
            fs.writeFileSync(resolved, content ?? '', 'utf8');
            return {
                success: true,
                path: resolved,
                bytesWritten: (content ?? '').length,
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: delete_file — deleta um arquivo do workspace.
 */
const deleteFileTool = buildTool({
    name: 'delete_file',
    description:
        'Deleta um arquivo do workspace. ' + '⚠️ REQUER APROVAÇÃO — OPERAÇÃO IRREVERSÍVEL. Não deleta diretórios.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo a deletar'),
    }),
    handler: async ({ path: filePath }) => {
        const { ok, reason, resolved } = await validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/delete_file] ${resolved}`);

        try {
            const stats = fs.statSync(resolved);
            if (stats.isDirectory()) {
                return { success: false, error: 'É um diretório. delete_file só opera em arquivos.' };
            }
            fs.unlinkSync(resolved);
            return { success: true, path: resolved, deleted: true };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: copy_file — copia um arquivo para outro caminho no workspace.
 */
const copyFileTool = buildTool({
    name: 'copy_file',
    description: 'Copia um arquivo para outro caminho no workspace. ' + '⚠️ REQUER APROVAÇÃO se o destino já existe.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) return { success: false, error: src.reason };

        const dst = await validatePath(destination);
        if (!dst.ok) return { success: false, error: dst.reason };

        log('INFO', `[copilot/copy_file] ${src.resolved} → ${dst.resolved}`);

        try {
            if (fs.existsSync(dst.resolved) && !overwrite) {
                return {
                    success: false,
                    error: 'Destino já existe. Passe overwrite: true para sobrescrever.',
                };
            }
            fs.mkdirSync(path.dirname(dst.resolved), { recursive: true });
            fs.copyFileSync(src.resolved, dst.resolved);
            const size = fs.statSync(dst.resolved).size;
            return { success: true, source: src.resolved, destination: dst.resolved, bytesWritten: size };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: move_file — move/renomeia um arquivo para outro caminho no workspace.
 */
const moveFileTool = buildTool({
    name: 'move_file',
    description: 'Move ou renomeia um arquivo no workspace. ' + '⚠️ REQUER APROVAÇÃO — remove o arquivo de origem.',
    parameters: z.object({
        source: z.string().describe('Caminho do arquivo de origem'),
        destination: z.string().describe('Caminho de destino'),
        overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
    }),
    handler: async ({ source, destination, overwrite }) => {
        const src = await validatePath(source, { mode: 'read' });
        if (!src.ok) return { success: false, error: src.reason };

        const dst = await validatePath(destination);
        if (!dst.ok) return { success: false, error: dst.reason };

        log('INFO', `[copilot/move_file] ${src.resolved} → ${dst.resolved}`);

        try {
            if (fs.existsSync(dst.resolved) && !overwrite) {
                return {
                    success: false,
                    error: 'Destino já existe. Passe overwrite: true para sobrescrever.',
                };
            }
            fs.mkdirSync(path.dirname(dst.resolved), { recursive: true });
            fs.renameSync(src.resolved, dst.resolved);
            return { success: true, source: src.resolved, destination: dst.resolved };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tool: patch_file — edição cirúrgica por substituição de string exata.
 */
const patchFileTool = buildTool({
    name: 'patch_file',
    description:
        'Aplica uma substituição cirúrgica num arquivo: substitui `old_string` por `new_string`. ' +
        '`old_string` deve ocorrer EXATAMENTE UMA VEZ no arquivo (inclua ≥3 linhas de contexto). ' +
        '⚠️ REQUER APROVAÇÃO — modifica o arquivo em disco.',
    parameters: z.object({
        path: z.string().describe('Caminho do arquivo (relativo ao workspace ou absoluto)'),
        old_string: z.string().min(1).describe('Texto exato a substituir. Deve ocorrer exatamente 1 vez no arquivo.'),
        new_string: z.string().describe('Texto de substituição (pode ser string vazia para deletar)'),
    }),
    handler: async ({ path: filePath, old_string, new_string }) => {
        const v = await validatePath(filePath);
        if (!v.ok) return { success: false, error: v.reason };

        if (!fs.existsSync(v.resolved)) {
            return { success: false, error: `Arquivo não encontrado: ${v.resolved}` };
        }

        let content;
        try {
            content = fs.readFileSync(v.resolved, 'utf8');
        } catch (/** @type {any} */ e) {
            return { success: false, error: `Erro ao ler arquivo: ${e.message}` };
        }

        const occurrences = content.split(old_string).length - 1;
        if (occurrences === 0) {
            return { success: false, error: 'old_string não encontrado no arquivo.' };
        }
        if (occurrences > 1) {
            return {
                success: false,
                error: `old_string encontrado ${occurrences} vezes. Inclua mais contexto para identificar unicamente.`,
            };
        }

        // BUG-HIGH-01 fix: escapar padrões especiais de substituição ($&, $', $`, $$, $n)
        // para que new_string seja tratado como literal e não como pattern de replacement
        const safeNewString = new_string.replace(/\$/g, '$$$$');
        const updated = content.replace(old_string, safeNewString);
        try {
            fs.writeFileSync(v.resolved, updated, 'utf8');
            log('INFO', `[copilot/patch_file] Patch aplicado: ${v.resolved}`);
            return { success: true, path: v.resolved };
        } catch (/** @type {any} */ e) {
            return { success: false, error: `Erro ao escrever arquivo: ${e.message}` };
        }
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UPG-N20/GAP-N10 (fix): Tool diff_files — exibe diferença unificada entre dois arquivos (usa `diff -u`).
 */
const diffFilesTool = buildTool({
    name: 'diff_files',
    description:
        'Exibe a diferença unificada (unified diff) entre dois arquivos do workspace. ' +
        'Útil para comparar versões ou verificar mudanças antes de aplicar patches.',
    parameters: z.object({
        path_a: z.string().describe('Caminho do primeiro arquivo (linha base / original)'),
        path_b: z.string().describe('Caminho do segundo arquivo (linha modificada / nova versão)'),
        context_lines: z
            .number()
            .int()
            .min(0)
            .max(20)
            .optional()
            .default(3)
            .describe('Número de linhas de contexto exibidas ao redor de cada mudança (padrão: 3)'),
    }),
    handler: async ({ path_a, path_b, context_lines }) => {
        const va = await validatePath(path_a, { mode: 'read' });
        if (!va.ok) return { success: false, error: `path_a: ${va.reason}` };
        const vb = await validatePath(path_b, { mode: 'read' });
        if (!vb.ok) return { success: false, error: `path_b: ${vb.reason}` };

        try {
            const { stdout } = await execFileAsync('diff', [`-U${context_lines ?? 3}`, va.resolved, vb.resolved]).catch(
                (err) => {
                    // diff retorna exit code 1 quando há diferenças — isso não é um erro
                    if (err.code === 1) return { stdout: err.stdout ?? '', stderr: '' };
                    throw err;
                },
            );
            const MAX_DIFF_BYTES = 64_000;
            const diff =
                stdout.length > MAX_DIFF_BYTES ? stdout.slice(0, MAX_DIFF_BYTES) + '\n[... diff truncado ...]' : stdout;
            return {
                success: true,
                path_a: va.resolved,
                path_b: vb.resolved,
                diff,
                identical: diff.trim() === '',
            };
        } catch (/** @type {any} */ err) {
            return { success: false, error: err.message };
        }
    },
});

/**
 * Tools de leitura do filesystem (skipPermission: true — não modificam estado).
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    withSkipPermission(listDirectoryTool),
    withSkipPermission(searchInFilesTool),
    withSkipPermission(diffFilesTool),
];

/**
 * Tools de escrita do filesystem (requirePermission — aprovação obrigatória). Não têm skipPermission — o SDK solicitará
 * aprovação antes de executar.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileWriteTools = [
    writeFileContentTool,
    createFileTool,
    deleteFileTool,
    copyFileTool,
    moveFileTool,
    patchFileTool,
];

/**
 * Conjunto completo de tools de filesystem (leitura + escrita).
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileTools = [...fileReadTools, ...fileWriteTools];
