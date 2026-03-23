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
import { defineTool } from '@github/copilot-sdk';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

/** Raiz do workspace derivada do meta.url (resolve para /workspaces/...) */
const WORKSPACE_ROOT = new URL('../../..', import.meta.url).pathname;

/** Limite máximo de bytes retornados por read_file_content */
const MAX_CONTENT_BYTES = 80_000;

/** Limite máximo de bytes retornados por search_in_file */
const MAX_SEARCH_OUTPUT = 20_000;

/** Limite máximo de entradas retornadas por list_directory */
const MAX_LIST_ENTRIES = 500;

/**
 * Padrões de arquivos bloqueados (segredos, chaves, credenciais). Avaliados contra o basename do arquivo.
 *
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS = [
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
 * Verifica se um caminho está dentro do workspace autorizado e não é um arquivo bloqueado.
 *
 * @param {string} filePath - Caminho absoluto ou relativo
 * @returns {{ ok: boolean; reason?: string; resolved: string }}
 */
function validatePath(filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
    const relativeToWorkspace = path.relative(WORKSPACE_ROOT, resolved);

    // Impede traversal fora do workspace
    if (relativeToWorkspace.startsWith('..')) {
        return { ok: false, reason: `Acesso negado: caminho fora do workspace (${resolved})`, resolved };
    }

    // Impede acesso a arquivos bloqueados
    const basename = path.basename(resolved);
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(basename)) {
            return { ok: false, reason: `Acesso negado: arquivo protegido (${basename})`, resolved };
        }
    }

    return { ok: true, resolved };
}

/**
 * Helper: marca uma tool como skipPermission (read-only; sem efeito em SDK <0.2.0).
 *
 * @template {import('@github/copilot-sdk').Tool<any>} T
 * @param {T} tool
 * @returns {T}
 */
const withSkipPermission = (tool) => Object.assign(tool, /** @type {any} */ ({ skipPermission: true }));

/**
 * Cast auxiliar que resolve inferência de tipo do SDK `defineTool<T>`.
 *
 * Necessário quando o handler retorna tipo union com shapes diferentes (ex: `{ success: true, ... } | { success: false,
 * error }`). Sem o cast, TypeScript infere T=unknown e exige `(args: unknown) => ...`, incompatível com o handler
 * desestruturado. Com T=any, `ToolHandler<any>` aceita qualquer função.
 *
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @returns {import('@github/copilot-sdk').ZodSchema<any>}
 */
const sdkParam = (schema) =>
    /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (/** @type {unknown} */ (schema));

// ─────────────────────────────────────────────────────────────────────────────
// OPERAÇÕES DE LEITURA (skipPermission: true)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool: read_file_content — lê o conteúdo de um arquivo.
 */
const readFileContentTool = defineTool('read_file_content', {
    description:
        'Lê o conteúdo de um arquivo no workspace. Arquivos de texto são retornados como string. ' +
        'Arquivos binários retornam uma indicação de tipo. Output limitado a 80KB.',
    parameters: sdkParam(
        z.object({
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
    ),
    handler: async ({ path: filePath, startLine, endLine, encoding }) => {
        const { ok, reason, resolved } = validatePath(filePath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/read_file_content] ${resolved}`);

        try {
            const stats = fs.statSync(resolved);
            if (stats.isDirectory()) return { success: false, error: 'É um diretório, use list_directory.' };

            const raw = fs.readFileSync(resolved);

            if (encoding === 'base64') {
                return {
                    success: true,
                    path: resolved,
                    size: stats.size,
                    encoding: 'base64',
                    content: raw.slice(0, MAX_CONTENT_BYTES).toString('base64'),
                    truncated: raw.length > MAX_CONTENT_BYTES,
                };
            }

            const text = raw.toString('utf8');
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
const listDirectoryTool = defineTool('list_directory', {
    description:
        'Lista o conteúdo de um diretório no workspace. Retorna nome, tipo (file/dir) e tamanho. ' +
        'Opcionalmente recursivo com limite de profundidade.',
    parameters: sdkParam(
        z.object({
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
            showHidden: z
                .boolean()
                .optional()
                .default(false)
                .describe('Incluir arquivos/diretórios ocultos (dotfiles)'),
            filter: z.string().optional().describe('Glob pattern para filtrar entradas (ex: *.js, *.md)'),
        }),
    ),
    handler: async ({ path: dirPath, recursive, depth, showHidden, filter }) => {
        const { ok, reason, resolved } = validatePath(dirPath);
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/list_directory] ${resolved} (recursive=${recursive}, depth=${depth})`);

        try {
            const stats = fs.statSync(resolved);
            if (!stats.isDirectory()) return { success: false, error: 'Não é um diretório, use read_file_content.' };

            /**
             * @param {string} dir
             * @param {number} currentDepth
             * @returns {{ name: string; type: string; size?: number; path: string; children?: any[] }[]}
             */
            function readDir(dir, currentDepth) {
                /** @type {string[]} */
                let entries;
                try {
                    entries = fs.readdirSync(dir);
                } catch {
                    return [];
                }

                /** @type {{ name: string; type: string; size?: number; path: string; children?: any[] }[]} */
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
                    /** @type {{ name: string; type: string; size?: number; path: string; children?: any[] }} */
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
const searchInFilesTool = defineTool('search_in_files', {
    description:
        'Busca texto ou regex em arquivos do workspace usando ripgrep (rg). ' +
        'Retorna correspondências com número de linha e contexto.',
    parameters: sdkParam(
        z.object({
            pattern: z.string().describe('Padrão de busca (texto literal ou regex)'),
            path: z
                .string()
                .optional()
                .default('.')
                .describe('Diretório ou arquivo onde buscar (relativo ao workspace)'),
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
    ),
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
        const { ok, reason, resolved } = validatePath(searchPath ?? '.');
        if (!ok) return { success: false, error: reason };

        log('INFO', `[copilot/search_in_files] pattern="${pattern}" in ${resolved}`);

        // Sanitize pattern to prevent command injection — use rg with -e flag (separate arg via execSync array isn't available,
        // but we'll wrap in single quotes and escape any single quotes in the pattern)
        const safePattern = pattern.replace(/'/g, "'\\''");
        const flags = [
            '--color=never',
            '--no-heading',
            isRegex ? '' : '--fixed-strings',
            caseSensitive ? '' : '--ignore-case',
            `--context=${contextLines ?? 2}`,
            `--max-count=${maxResults ?? 50}`,
            includePattern ? `--glob='${includePattern.replace(/'/g, "'\\''")}'` : '',
            excludePattern ? `--glob='!${excludePattern.replace(/'/g, "'\\''")}'` : '',
            '--glob=!node_modules',
            '--glob=!.git',
            '--glob=!dist',
        ]
            .filter(Boolean)
            .join(' ');

        const cmd = `rg ${flags} -e '${safePattern}' '${resolved}' 2>&1 | head -c ${MAX_SEARCH_OUTPUT}`;

        try {
            const output = execSync(cmd, {
                cwd: WORKSPACE_ROOT,
                encoding: 'utf8',
                timeout: 30000,
            });
            return {
                success: true,
                pattern,
                searchPath: resolved,
                output: output.slice(0, MAX_SEARCH_OUTPUT),
                truncated: output.length >= MAX_SEARCH_OUTPUT,
            };
        } catch (/** @type {any} */ err) {
            // exit code 1 = no matches (not an error for rg)
            if (err.status === 1 && !err.stderr) {
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
const writeFileContentTool = defineTool('write_file_content', {
    description:
        'Escreve conteúdo em um arquivo existente no workspace. ' +
        '⚠️ REQUER APROVAÇÃO — sobrescreve conteúdo existente. Use create_file para arquivos novos.',
    parameters: sdkParam(
        z.object({
            path: z.string().describe('Caminho do arquivo (deve existir)'),
            content: z.string().describe('Novo conteúdo completo do arquivo'),
            encoding: z
                .enum(['utf8', 'base64'])
                .optional()
                .default('utf8')
                .describe('Codificação do conteúdo (utf8 para texto, base64 para binário)'),
        }),
    ),
    handler: async ({ path: filePath, content, encoding }) => {
        const { ok, reason, resolved } = validatePath(filePath);
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
const createFileTool = defineTool('create_file', {
    description:
        'Cria um novo arquivo no workspace com conteúdo opcional. ' +
        '⚠️ REQUER APROVAÇÃO — o arquivo não deve existir previamente (use write_file_content para sobrescrever).',
    parameters: sdkParam(
        z.object({
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
    ),
    handler: async ({ path: filePath, content, createParentDirs, overwrite }) => {
        const { ok, reason, resolved } = validatePath(filePath);
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
const deleteFileTool = defineTool('delete_file', {
    description:
        'Deleta um arquivo do workspace. ' + '⚠️ REQUER APROVAÇÃO — OPERAÇÃO IRREVERSÍVEL. Não deleta diretórios.',
    parameters: sdkParam(
        z.object({
            path: z.string().describe('Caminho do arquivo a deletar'),
        }),
    ),
    handler: async ({ path: filePath }) => {
        const { ok, reason, resolved } = validatePath(filePath);
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
const copyFileTool = defineTool('copy_file', {
    description: 'Copia um arquivo para outro caminho no workspace. ' + '⚠️ REQUER APROVAÇÃO se o destino já existe.',
    parameters: sdkParam(
        z.object({
            source: z.string().describe('Caminho do arquivo de origem'),
            destination: z.string().describe('Caminho de destino'),
            overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
        }),
    ),
    handler: async ({ source, destination, overwrite }) => {
        const src = validatePath(source);
        if (!src.ok) return { success: false, error: src.reason };

        const dst = validatePath(destination);
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
const moveFileTool = defineTool('move_file', {
    description: 'Move ou renomeia um arquivo no workspace. ' + '⚠️ REQUER APROVAÇÃO — remove o arquivo de origem.',
    parameters: sdkParam(
        z.object({
            source: z.string().describe('Caminho do arquivo de origem'),
            destination: z.string().describe('Caminho de destino'),
            overwrite: z.boolean().optional().default(false).describe('Sobrescrever destino se existir'),
        }),
    ),
    handler: async ({ source, destination, overwrite }) => {
        const src = validatePath(source);
        if (!src.ok) return { success: false, error: src.reason };

        const dst = validatePath(destination);
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tools de leitura do filesystem (skipPermission: true — não modificam estado).
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    withSkipPermission(listDirectoryTool),
    withSkipPermission(searchInFilesTool),
];

/**
 * Tools de escrita do filesystem (requirePermission — aprovação obrigatória). Não têm skipPermission — o SDK solicitará
 * aprovação antes de executar.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileWriteTools = [writeFileContentTool, createFileTool, deleteFileTool, copyFileTool, moveFileTool];

/**
 * Conjunto completo de tools de filesystem (leitura + escrita).
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const fileTools = [...fileReadTools, ...fileWriteTools];
