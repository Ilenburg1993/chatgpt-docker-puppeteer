// @ts-check
/**
 * src/copilot/tools/file/read-tools-io.js
 *
 * Tools de IO: read_file_content, list_directory.
 *
 * @module copilot/tools/file/read-tools-io
 * @see EventBus
 */

import { isUtf8 } from 'node:buffer';
import * as fs from 'node:fs';
import { readdir as fsReaddir, stat as fsStat } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { toError } from '../../core/error-handlers.js';
import { log } from '../logger.js';
import { buildTool } from '../tool-factory.js';
import { MAX_CONTENT_BYTES, MAX_LIST_ENTRIES, WORKSPACE_ROOT, concatChunks, validatePath } from './shared.js';

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
        if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
            return { success: false, error: 'Intervalo inválido: endLine deve ser maior ou igual a startLine.' };
        }

        log('INFO', `[copilot/read_file_content] ${resolved}`);

        try {
            const stats = await fsStat(resolved);
            if (stats.isDirectory()) return { success: false, error: 'É um diretório, use list_directory.' };

            if (encoding === 'base64') {
                const chunks = /** @type {Buffer[]} */ ([]);
                await new Promise((resolve, reject) => {
                    const stream = fs.createReadStream(resolved, { end: MAX_CONTENT_BYTES - 1 });
                    stream.on('data', (chunk) => chunks.push(/** @type {Buffer} */ (chunk)));
                    stream.on('end', resolve);
                    stream.on('error', reject);
                });
                // concatChunks computa totalLength automaticamente — evita segunda passagem interna
                const raw = concatChunks(chunks);
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
            // concatChunks computa totalLength automaticamente — evita segunda passagem interna
            const rawText = concatChunks(textChunks);
            // Detectar arquivo binário antes de tentar decodificar como UTF-8
            if (!isUtf8(rawText)) {
                return {
                    success: false,
                    error: 'Arquivo binário detectado (bytes inválidos para UTF-8). Use encoding: "base64" para ler arquivos binários.',
                };
            }
            const text = rawText.toString('utf8');
            const lines = text.split('\n');
            const total = lines.length;

            const s = (startLine ?? 1) - 1;
            const e = endLine ?? total;
            const slice = lines.slice(s, e).join('\n');
            const streamTruncated = stats.size > MAX_CONTENT_BYTES * 3;
            const contentTruncated = slice.length > MAX_CONTENT_BYTES;
            const truncated = streamTruncated || contentTruncated;

            return {
                success: true,
                path: resolved,
                size: stats.size,
                totalLines: total,
                returnedLines: { start: s + 1, end: Math.min(e, total) },
                content: truncated ? slice.slice(0, MAX_CONTENT_BYTES) + '\n[... conteúdo truncado ...]' : slice,
                truncated,
                ...(streamTruncated ? { truncationReason: 'input_stream_limit' } : {}),
            };
        } catch (err) {
            return { success: false, error: toError(err).message };
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
            const stats = await fsStat(resolved);
            if (!stats.isDirectory()) return { success: false, error: 'Não é um diretório, use read_file_content.' };

            let remainingEntries = MAX_LIST_ENTRIES;

            /**
             * @param {string} dir
             * @param {number} currentDepth
             * @returns {Promise<DirEntry[]>}
             */
            async function readDir(dir, currentDepth) {
                /** @type {string[]} */
                let entries;
                try {
                    entries = await fsReaddir(dir);
                } catch {
                    return [];
                }
                entries.sort((a, b) => a.localeCompare(b));

                /** @type {DirEntry[]} */
                const result = [];
                for (const name of entries) {
                    if (remainingEntries <= 0) break;
                    if (!showHidden && name.startsWith('.')) continue;
                    if (filter) {
                        const globMatch = filter.startsWith('*.') ? name.endsWith(filter.slice(1)) : name === filter;
                        if (!globMatch) {
                            try {
                                if (!(await fsStat(path.join(dir, name))).isDirectory()) continue;
                            } catch {
                                continue;
                            }
                        }
                    }
                    if (remainingEntries <= 0) break;

                    const full = path.join(dir, name);
                    const rel = path.relative(WORKSPACE_ROOT, full);
                    let entryStats;
                    try {
                        entryStats = await fsStat(full);
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
                        entry.children = await readDir(full, currentDepth + 1);
                    }
                    result.push(entry);
                    remainingEntries -= 1;
                }
                return result;
            }

            const entries = await readDir(resolved, 1);
            return {
                success: true,
                path: resolved,
                count: entries.length,
                truncated: remainingEntries <= 0,
                scannedBudget: MAX_LIST_ENTRIES - remainingEntries,
                entries,
            };
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

export { listDirectoryTool, readFileContentTool };
