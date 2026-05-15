// @ts-check
/**
 * Engine canônica de I/O local para `src/copilot`.
 *
 * Limites de tamanho são informativos por desenho: a engine mede bytes e sinaliza advisory metadata, mas não bloqueia
 * operações por tamanho. Barreiras de segurança continuam pertencendo às policies de path/URL dos adapters.
 *
 * @module copilot/infra/io-engine
 */

import { withIoResourceLock } from './io-locks.js';
import {
    copyFileLocked as copyFileLockedInFsMutations,
    deleteFileLocked as deleteFileLockedInFsMutations,
    moveFileLocked as moveFileLockedInFsMutations,
    patchTextLocked as patchTextLockedInFsMutations,
    removePathLocked as removePathLockedInFsMutations,
} from './io/fs/locked-mutations.js';
import {
    appendTextLocked as appendTextLockedInFsWrites,
    createOrReplaceFileAtomic as createOrReplaceFileAtomicInFsWrites,
    mkdirPathLocked as mkdirPathLockedInFsWrites,
    writeFileAtomic as writeFileAtomicInFsWrites,
} from './io/fs/locked-writes.js';
import {
    readBytes as readBytesInReadServices,
    readLines as readLinesInReadServices,
    readTextChunks as readTextChunksInReadServices,
    readText as readTextInReadServices,
    statPath as statPathInReadServices,
} from './io/fs/read-services.js';
import { diffTextWithReader } from './io/patch/index.js';
import {
    searchText as searchTextInSearchModule,
    searchWorkspaceSymbols as searchWorkspaceSymbolsInSearchModule,
} from './io/search/text-search.js';
import { assertValidIoFilePath } from './policy/path-resource.js';

export const readBytes = readBytesInReadServices;

export const readText = readTextInReadServices;

export const readLines = readLinesInReadServices;

export const readTextChunks = readTextChunksInReadServices;

export const writeFileAtomic = writeFileAtomicInFsWrites;

export const createOrReplaceFileAtomic = createOrReplaceFileAtomicInFsWrites;

export const appendTextLocked = appendTextLockedInFsWrites;

/**
 * Stat canônico com observabilidade. Leitura metadata-only, sem bloqueio por tamanho.
 *
 * @param {string} filePath
 * @param {{ traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     stats: import('node:fs').Stats;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export const statPath = statPathInReadServices;

/**
 * Cria diretório com lock por path, preservando a semântica do SDK SessionFsProvider.mkdir().
 *
 * @param {string} dirPath
 * @param {{ recursive?: boolean; mode?: number; traceId?: string; advisoryLimits?: Record<string, unknown> }} [options]
 * @returns {Promise<{
 *     path: string;
 *     created: true;
 *     io: import('../core/io-contracts.js').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export const mkdirPathLocked = mkdirPathLockedInFsWrites;

export const deleteFileLocked = deleteFileLockedInFsMutations;

export const removePathLocked = removePathLockedInFsMutations;

export const copyFileLocked = copyFileLockedInFsMutations;

export const moveFileLocked = moveFileLockedInFsMutations;

export const patchTextLocked = patchTextLockedInFsMutations;

/**
 * Diff textual simples, sem invocar processo externo.
 *
 * @param {string} pathA
 * @param {string} pathB
 * @param {{ contextLines?: number }} [options]
 */
export async function diffText(pathA, pathB, options = {}) {
    assertValidIoFilePath(pathA);
    assertValidIoFilePath(pathB);
    return diffTextWithReader(
        async (path) => {
            const textResult = await readText(path);
            return {
                content: textResult.content,
                bytesRead: textResult.bytesRead,
            };
        },
        pathA,
        pathB,
        options,
    );
}

/** @typedef {'function' | 'class' | 'variable' | 'export' | 'type' | 'all'} IoSymbolKind */

/**
 * Busca texto/regex em arquivos já validados pelo adapter da tool.
 *
 * @param {string} targetPath
 * @param {{
 *     workspaceRoot?: string;
 *     pattern: string;
 *     isRegex?: boolean;
 *     caseSensitive?: boolean;
 *     includePattern?: string;
 *     excludePattern?: string;
 *     contextLines?: number;
 *     maxResults?: number;
 *     cursor?: string | number | null;
 *     traceId?: string;
 * }} options
 * @returns {Promise<{
 *     targetPath: string;
 *     pattern: string;
 *     output: string;
 *     matchCount: number;
 *     engine: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     truncated?: boolean;
 *     nextCursor?: string | null;
 *     cursorOffset?: number;
 *     totalMatches?: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export const searchText = searchTextInSearchModule;

/**
 * Busca símbolos em arquivos já validados pelo adapter da tool.
 *
 * @param {string} targetPath
 * @param {{
 *     workspaceRoot?: string;
 *     symbolName: string;
 *     kind?: IoSymbolKind;
 *     includePattern?: string;
 *     caseSensitive?: boolean;
 *     maxResults?: number;
 *     cursor?: string | number | null;
 *     traceId?: string;
 * }} options
 * @returns {Promise<{
 *     targetPath: string;
 *     symbol: string;
 *     kind: IoSymbolKind;
 *     output: string;
 *     matchCount: number;
 *     message?: string;
 *     engine: string;
 *     sanitized: boolean;
 *     redactions: number;
 *     truncated?: boolean;
 *     nextCursor?: string | null;
 *     cursorOffset?: number;
 *     totalMatches?: number;
 *     io: import('../core/io-contracts.js').IoMeta;
 * }>}
 */
export const searchWorkspaceSymbols = searchWorkspaceSymbolsInSearchModule;

export { withIoResourceLock };
