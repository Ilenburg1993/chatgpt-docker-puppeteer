// @ts-check
/**
 * src/copilot/tools/file/read-tools-io.js
 *
 * Tools de IO: read_file_content, list_directory.
 *
 * @module copilot/tools/file/read-tools-io
 * @see EventBus
 */

import { stat as fsStat } from 'node:fs/promises';
import { z } from 'zod';
import { toError } from '../../core/error-handlers.js';
import { withIoMeta } from '../../core/io-contracts.js';
import { readBytes, readText } from '../../infra/io-engine.js';
import { scanDirectory } from '../../infra/io-scanner.js';
import { log } from '../logger.js';
import { buildTool } from '../tool-factory.js';
import { WORKSPACE_ROOT, validatePath } from './shared.js';

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
        'Arquivos de texto são retornados como string. Arquivos binários retornam uma indicação de tipo.',
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
                const raw = await readBytes(resolved);
                return withIoMeta(
                    {
                        success: true,
                        path: resolved,
                        size: stats.size,
                        encoding: 'base64',
                        content: raw.content.toString('base64'),
                        truncated: false,
                    },
                    raw.io,
                );
            }

            const text = await readText(resolved, { startLine, endLine });
            const truncated = false;

            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    size: stats.size,
                    totalLines: text.totalLines,
                    returnedLines: text.returnedLines,
                    content: text.content,
                    truncated,
                },
                { ...text.io, truncated },
            );
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
            .optional()
            .default(3)
            .describe('Profundidade máxima para listagem recursiva. Informativa e controlada pelo caller.'),
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
            const scan = await scanDirectory(resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                recursive,
                depth,
                showHidden,
                filter,
            });

            /**
             * @param {import('../../infra/io-scanner.js').IoScanEntry} entry
             * @returns {DirEntry}
             */
            const toLegacyEntry = (entry) => {
                const legacy = /** @type {DirEntry} */ ({
                    name: entry.name,
                    type: entry.type === 'directory' ? 'dir' : entry.type,
                    path: entry.path,
                });
                if (entry.size !== undefined) legacy.size = entry.size;
                if (entry.children) legacy.children = entry.children.map(toLegacyEntry);
                return legacy;
            };
            const entries = scan.entries.map(toLegacyEntry);
            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    count: entries.length,
                    truncated: false,
                    scannedBudget: scan.scannedEntries,
                    entries,
                },
                { ...scan.io, truncated: false },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

export { listDirectoryTool, readFileContentTool };
