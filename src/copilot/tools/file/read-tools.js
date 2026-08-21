// @ts-check
import { toError, withIoMeta } from '#copilot/core';
import { createWorkspaceIo } from '#copilot/infra/public/filesystem/workspace';
import { createWorkspaceIndexing } from '#copilot/infra/public/indexing/workspace';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
import { readFileContentTool, readFilesBatchTool } from './read/index.js';
/**
 * src/copilot/tools/file/read-tools.js
 *
 * Barrel canônico das file read tools. Contém: readFileContent, listDirectory, diffFiles. Search tools
 * (search_in_files, workspace_symbol_search, find_symbol_usages) vivem em `../search/`.
 *
 * @module copilot/tools/file/read-tools
 */

import {
    applyEntryLimit,
    applyEntryWindow,
    FILE_TOOLS_OUTPUT_POLICY,
    truncateUtf8Text,
    validatePath,
    WORKSPACE_ROOT,
} from './shared.js';

const { diffText, diffTextValidated, statPath, statPathValidated } = createWorkspaceIo({
    workspaceRoot: WORKSPACE_ROOT,
});
const { scanDirectory, scanDirectoryValidated } = createWorkspaceIndexing({ workspaceRoot: WORKSPACE_ROOT });

/** @param {{ resolved: string; validatedReadPath?: import('#copilot/infra/public/filesystem/workspace').ValidatedReadWorkspacePath }} target @param {Parameters<typeof scanDirectory>[1]}
  options */
function scanValidatedOrString(target, options) {
    return target.validatedReadPath
        ? scanDirectoryValidated(target.validatedReadPath, options)
        : scanDirectory(target.resolved, options);
}

/** @param {{ resolved: string; validatedReadPath?: import('#copilot/infra/public/filesystem/workspace').ValidatedReadWorkspacePath }} pathA @param {{ resolved: string; validatedReadPath?: import('#copilot/infra/public/filesystem/workspace').ValidatedReadWorkspacePath }} pathB @param {Parameters<typeof diffText>[2]} options */
function diffValidatedPairOrString(pathA, pathB, options) {
    return pathA.validatedReadPath && pathB.validatedReadPath
        ? diffTextValidated(pathA.validatedReadPath, pathB.validatedReadPath, options)
        : diffText(pathA.resolved, pathB.resolved, options);
}

/** @param {{ resolved: string; validatedReadPath?: import('#copilot/infra/public/filesystem/workspace').ValidatedReadWorkspacePath }} target */
function statValidatedOrString(target) {
    return target.validatedReadPath ? statPathValidated(target.validatedReadPath) : statPath(target.resolved);
}

export { readFileContentTool, readFilesBatchTool } from './read/index.js';

/**
 * @typedef {object} IoScanEntry
 * @property {string} name
 * @property {'file' | 'directory' | 'symlink' | 'other'} type
 * @property {string} path
 * @property {number} [size]
 * @property {IoScanEntry[]} [children]
 */

/**
 * Tool: list_directory — lista o conteúdo de um diretório.
 */
export const listDirectoryTool = buildTool({
    name: 'list_directory',
    description:
        'Lista o conteúdo de um diretório no workspace. Retorna nome, tipo (file/dir) e tamanho. ' +
        'Opcionalmente recursivo com limite de profundidade.',
    parameters: z.object({
        path: z.string()['describe']('Caminho do diretório (relativo ao workspace ou absoluto)'),
        recursive: z.boolean().optional().default(false)['describe']('Se true, lista recursivamente'),
        depth: z
            .number()
            .int()
            .min(1)
            .optional()
            .default(3)
            ['describe']('Profundidade máxima para listagem recursiva. Informativa e controlada pelo caller.'),
        showHidden: z.boolean().optional().default(false)['describe']('Incluir arquivos/diretórios ocultos (dotfiles)'),
        filter: z.string().optional()['describe']('Glob pattern para filtrar entradas (ex: *.js, *.md)'),
        maxEntries: z.number().int().positive().optional()['describe']('Máximo de entradas de topo a retornar.'),
        cursor: z.string().optional()['describe']('Cursor numérico retornado por chamada anterior.'),
    }),
    handler: async ({ path: dirPath, recursive, depth, showHidden, filter, maxEntries, cursor }) => {
        const validated = await validatePath(dirPath, { mode: 'read', issueReadCapability: true });
        if (!validated.ok) return { success: false, error: validated.reason };
        const { resolved } = validated;

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
            const stats = (await statValidatedOrString(validated)).stats;
            if (!stats.isDirectory()) return { success: false, error: 'Não é um diretório, use read_file_content.' };
            const scan = await scanValidatedOrString(validated, {
                recursive,
                depth,
                showHidden,
                filter,
            });

            /**
             * @param {IoScanEntry} entry
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
            const configuredMaxEntries = maxEntries ?? FILE_TOOLS_OUTPUT_POLICY.maxListEntries;
            const limitedEntries =
                cursor !== undefined || maxEntries !== undefined
                    ? applyEntryWindow(entries, { maxEntries: configuredMaxEntries, cursor })
                    : applyEntryLimit(entries, configuredMaxEntries);
            if (limitedEntries.truncated) {
                log(
                    'INFO',
                    `[copilot/list_directory] saída truncada por política (${configuredMaxEntries} entries) em ${resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    path: resolved,
                    count: limitedEntries.entries.length,
                    truncated: limitedEntries.truncated,
                    nextCursor: 'nextCursor' in limitedEntries ? limitedEntries.nextCursor : null,
                    cursorOffset: 'cursorOffset' in limitedEntries ? limitedEntries.cursorOffset : 0,
                    scannedBudget: scan.scannedEntries,
                    blockedEntriesCount: scan.blockedEntries,
                    securityPolicy: {
                        readProtectedPaths: 'blocked',
                        listProtectedPaths: 'redacted',
                        writeProtectedPaths: 'blocked',
                    },
                    totalEntries: limitedEntries.totalEntries,
                    ...(limitedEntries.truncated ? { configuredLimitEntries: configuredMaxEntries } : {}),
                    entries: limitedEntries.entries,
                },
                { ...scan.io, truncated: limitedEntries.truncated },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

/**
 * Tool: diff_files — exibe diferença unificada entre dois arquivos.
 */
export const diffFilesTool = buildTool({
    name: 'diff_files',
    description:
        'Exibe a diferença unificada (unified diff) entre dois arquivos do workspace. ' +
        'Útil para comparar versões ou verificar mudanças antes de aplicar patches.',
    parameters: z.object({
        path_a: z.string()['describe']('Caminho do primeiro arquivo (linha base / original)'),
        path_b: z.string()['describe']('Caminho do segundo arquivo (linha modificada / nova versão)'),
        context_lines: z
            .number()
            .int()
            .min(0)
            .optional()
            .default(3)
            ['describe']('Número de linhas de contexto exibidas ao redor de cada mudança (padrão histórico: 3)'),
    }),
    handler: async ({ path_a, path_b, context_lines }) => {
        const va = await validatePath(path_a, { mode: 'read', issueReadCapability: true });
        if (!va.ok) return { success: false, error: `path_a: ${va.reason}` };
        const vb = await validatePath(path_b, { mode: 'read', issueReadCapability: true });
        if (!vb.ok) return { success: false, error: `path_b: ${vb.reason}` };

        try {
            const diff = await diffValidatedPairOrString(va, vb, { contextLines: context_lines ?? 3 });
            const diffOutput = truncateUtf8Text(
                diff.diff,
                FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes,
                Number.isFinite(FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes)
                    ? `\n\n⚠️ [diff truncado por política COPILOT_FILE_TOOLS_MAX_DIFF_OUTPUT_BYTES=${FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes}]`
                    : undefined,
            );
            if (diffOutput.truncated) {
                log(
                    'INFO',
                    `[copilot/diff_files] diff truncado por política (${FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes} bytes) entre ${va.resolved} e ${vb.resolved}`,
                );
            }
            return withIoMeta(
                {
                    success: true,
                    path_a: va.resolved,
                    path_b: vb.resolved,
                    diff: diffOutput.text,
                    identical: diff.identical,
                    engine: diff.io.engine,
                    truncated: diffOutput.truncated,
                    ...(diffOutput.truncated
                        ? {
                              configuredLimitBytes: FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes,
                              originalDiffBytes: diffOutput.originalBytes,
                          }
                        : {}),
                },
                { ...diff.io, truncated: diffOutput.truncated },
            );
        } catch (err) {
            return { success: false, error: toError(err).message };
        }
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const fileReadTools = [
    withSkipPermission(readFileContentTool),
    withSkipPermission(readFilesBatchTool),
    listDirectoryTool,
    diffFilesTool,
];
