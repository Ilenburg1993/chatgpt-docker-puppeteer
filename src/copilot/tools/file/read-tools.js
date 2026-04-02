// @ts-check
/**
 * src/copilot/tools/file/read-tools.js
 *
 * Tools de leitura do filesystem: read_file_content, list_directory, search_in_files, diff_files.
 *
 * @module copilot/tools/file/read-tools
 * @see module:copilot/tools/file/shared
 */

import { log } from '#copilot/observability/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { buildTool, withSkipPermission } from '../tool-factory.js';
import {
    MAX_CONTENT_BYTES,
    MAX_LIST_ENTRIES,
    MAX_SEARCH_OUTPUT,
    WORKSPACE_ROOT,
    execFileAsync,
    isRgAvailable,
    validatePath,
} from './shared.js';

// ---------------------------------------------------------------------------
// Tool: read_file_content
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: list_directory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool: search_in_files
// ---------------------------------------------------------------------------

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
            if (!(await isRgAvailable())) {
                return { success: false, error: 'ripgrep (rg) não está disponível neste ambiente.' };
            }
            const { stdout, stderr: _stderr } = await execFileAsync('rg', rgArgs, {
                cwd: WORKSPACE_ROOT,
                timeout: 30000,
                maxBuffer: MAX_SEARCH_OUTPUT * 4,
            });
            const SENSITIVE_LINE_RE = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
            const filteredOutput = stdout
                .split('\n')
                .filter((line) => !SENSITIVE_LINE_RE.test(line))
                .join('\n')
                .slice(0, MAX_SEARCH_OUTPUT);
            return {
                success: true,
                pattern,
                searchPath: resolved,
                output: filteredOutput,
                truncated: stdout.length >= MAX_SEARCH_OUTPUT,
            };
        } catch (/** @type {any} */ err) {
            if ((err.code === 1 || err.status === 1) && !err.stderr) {
                return { success: true, pattern, searchPath: resolved, output: '', matchCount: 0 };
            }
            return { success: false, error: err.stderr ?? err.message };
        }
    },
});

// ---------------------------------------------------------------------------
// Tool: diff_files
// ---------------------------------------------------------------------------

/**
 * Tool: diff_files — exibe diferença unificada entre dois arquivos.
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { diffFilesTool, listDirectoryTool, readFileContentTool, searchInFilesTool };

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
