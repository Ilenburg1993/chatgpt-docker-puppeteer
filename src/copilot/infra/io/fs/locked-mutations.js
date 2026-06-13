// @ts-check
/**
 * Mutações de filesystem protegidas por lock (delete/remove/copy/move/patch).
 *
 * Extraído do `io-engine` para reduzir acoplamento e manter a facade pública estável.
 *
 * @module copilot/infra/io/fs/locked-mutations
 */

import { buildIoMeta, createIoTraceId, withIoMeta } from '#copilot/core';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { acquireIoResourceLock, acquireIoResourceLocks } from '../../io-locks.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { assertValidIoFilePath } from '../../policy/path-resource.js';
import { assertExpectedSha256 } from '../../policy/preconditions.js';
import { decodeUtf8Buffer, toOwnedBuffer, utf8ByteLength } from '../../shared/buffer.js';
import { sha256 } from '../../shared/hash.js';
import { invalidateIoCacheTiers, invalidateIoCacheTierSubtrees } from '../invalidation/cache-tiers.js';
import { buildSimpleTextDiff, computeTextPatch } from '../patch/index.js';
import { copyFileUnlocked } from './copy.js';
import { mkdirPathUnlocked } from './mkdir.js';
import { moveFileUnlocked } from './move.js';
import { deleteFileUnlocked, removePathUnlocked } from './remove.js';
import { persistRollbackSidecar } from './rollback-sidecar.js';
import { readBinaryMutationSnapshot } from './snapshot.js';
import { writeAtomicFileUnlocked } from './write-atomic.js';

const ROLLBACK_SNAPSHOT_MAX_BYTES = 256 * 1024;
const DEFAULT_PATCH_DIFF_CONTEXT_LINES = 3;
const DEFAULT_PATCH_DIFF_MAX_LINES = 160;
const DEFAULT_PATCH_DIFF_MAX_BYTES = 48 * 1024;

/**
 * @param {number} startedAt
 * @returns {number}
 */
function elapsedMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}

/**
 * @param {import('#copilot/core/io-contracts').IoMeta} io
 * @param {boolean} success
 * @param {unknown} [error]
 * @returns {import('#copilot/core/io-contracts').IoMeta}
 */
function publishAndReturn(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

/**
 * @param {string} text
 * @param {{ maxLines?: number; maxBytes?: number }} [options]
 * @returns {{ text: string; truncated: boolean; lines: number; bytes: number }}
 */
function windowTextPreview(text, options = {}) {
    const maxLines = Math.max(1, Math.trunc(options.maxLines ?? DEFAULT_PATCH_DIFF_MAX_LINES));
    const maxBytes = Math.max(256, Math.trunc(options.maxBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES));
    const lines = text.split('\n');
    let truncated = lines.length > maxLines;
    let preview = lines.slice(0, maxLines).join('\n');
    let bytes = utf8ByteLength(preview, 'diff preview');
    if (bytes > maxBytes) {
        let end = preview.length;
        while (end > 0 && utf8ByteLength(preview.slice(0, end), 'diff preview') > maxBytes) {
            end = Math.max(0, end - 512);
        }
        preview = preview.slice(0, end);
        bytes = utf8ByteLength(preview, 'diff preview');
        truncated = true;
    }
    return { text: preview, truncated, lines: Math.min(lines.length, maxLines), bytes };
}

/**
 * @param {string} filePath
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
 * }>}
 */
async function readMutationSnapshot(filePath, captureRollback = false) {
    return readBinaryMutationSnapshot(filePath, {
        snapshotMaxBytes: ROLLBACK_SNAPSHOT_MAX_BYTES,
        rollbackSidecar: captureRollback,
    });
}

/**
 * @param {string} filePath
 * @returns {Promise<{
 *     contentHash: string;
 *     bytesRead: number;
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
 * } | null>}
 */
async function readOptionalMutationSnapshot(filePath, captureRollback = false) {
    try {
        return await readMutationSnapshot(filePath, captureRollback);
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return null;
        throw error;
    }
}

/**
 * @param {string} destination
 * @param {boolean | undefined} overwrite
 * @returns {Promise<void>}
 */
async function assertDestinationWritable(destination, overwrite) {
    if (overwrite) return;
    try {
        await fs.access(destination);
    } catch (error) {
        const err = /** @type {{ code?: unknown; message?: unknown }} */ (error);
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || String(err.message ?? '').includes('ENOENT')) return;
        throw error;
    }
    const error = new Error(`Destino já existe: ${destination}`);
    /** @type {{ code?: string }} */ (error).code = 'EEXIST';
    throw error;
}

/**
 * @param {Buffer} content
 * @param {{ persistLarge?: boolean; contentHash?: string }} [options]
 * @returns {Promise<{
 *     snapshotBase64: string | null;
 *     snapshotTruncated: boolean;
 *     rollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
 * }>}
 */
async function buildRollbackSnapshot(content, options = {}) {
    if (content.byteLength <= ROLLBACK_SNAPSHOT_MAX_BYTES) {
        return { snapshotBase64: content.toString('base64'), snapshotTruncated: false, rollbackSidecar: null };
    }
    const rollbackSidecar = options.persistLarge
        ? await persistRollbackSidecar(content, {
              ...(options.contentHash === undefined ? {} : { contentHash: options.contentHash }),
          })
        : null;
    return { snapshotBase64: null, snapshotTruncated: true, rollbackSidecar };
}

/**
 * Remove arquivo com lock por path.
 *
 * @param {string} filePath
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 *     previousHash: string;
 *     previousBytes: number;
 *     previousSnapshotBase64: string | null;
 *     previousSnapshotTruncated: boolean;
 *     previousRollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
 * }>}
 */
export async function deleteFileLocked(filePath) {
    assertValidIoFilePath(filePath);
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'delete',
            target: filePath,
            riskClass: 'high',
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const snapshot = await readMutationSnapshot(filePath, true);
                    await deleteFileUnlocked(filePath);
                    return snapshot;
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                bytesRead: value.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    previousHash: value.contentHash,
                    rollbackSidecar: value.rollbackSidecar
                        ? {
                              available: true,
                              bytes: value.rollbackSidecar.bytes,
                              expiresAtMs: value.rollbackSidecar.expiresAtMs,
                          }
                        : null,
                },
            }),
            true,
        );
        return withIoMeta(
            {
                path: filePath,
                deleted: /** @type {const} */ (true),
                lockWaitMs: waitMs,
                previousHash: value.contentHash,
                previousBytes: value.bytesRead,
                previousSnapshotBase64: value.snapshotBase64,
                previousSnapshotTruncated: value.snapshotTruncated,
                previousRollbackSidecar: value.rollbackSidecar,
            },
            io,
        );
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Remove arquivo ou diretório com lock por path.
 *
 * @param {string} filePath
 * @param {{ recursive?: boolean; force?: boolean; traceId?: string }} [options]
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 * }>}
 */
export async function removePathLocked(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'delete',
            target: filePath,
            riskClass: 'high',
        });
        try {
            await lease.run(async () =>
                removePathUnlocked(filePath, { recursive: Boolean(options.recursive), force: Boolean(options.force) }),
            );
        } finally {
            await lease.releaseAsync();
        }
        const waitMs = lease.waitMs;
        invalidateIoCacheTierSubtrees(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                    force: Boolean(options.force),
                },
            }),
            true,
        );
        return withIoMeta({ path: filePath, deleted: /** @type {const} */ (true), lockWaitMs: waitMs }, io);
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Copia arquivo com lock no destino.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string }} [options]
 */
export async function copyFileLocked(source, destination, options = {}) {
    assertValidIoFilePath(source);
    assertValidIoFilePath(destination);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.overwrite ? 'high' : 'medium';
    try {
        const lease = await acquireIoResourceLocks([source, destination], {
            operation: 'copy',
            target: destination,
            riskClass,
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    /**
                     * @type {{
                     *     contentHash: string;
                     *     bytesRead: number;
                     *     snapshotBase64: string | null;
                     *     snapshotTruncated: boolean;
                     *     rollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
                     * } | null}
                     */
                    let destinationSnapshot = null;
                    if (options.overwrite) {
                        destinationSnapshot = await readOptionalMutationSnapshot(destination, true);
                    } else {
                        await assertDestinationWritable(destination, options.overwrite);
                    }
                    const sourceSnapshot = await readMutationSnapshot(source);
                    await mkdirPathUnlocked(dirname(destination), { recursive: true });
                    const copyResult = await copyFileUnlocked(source, destination, {
                        exclusive: !options.overwrite,
                        expectedSourceHash: sourceSnapshot.contentHash,
                        expectedSourceBytes: sourceSnapshot.bytesRead,
                    });
                    return {
                        bytesWritten: copyResult.destinationBytes,
                        sourceHash: sourceSnapshot.contentHash,
                        sourceBytes: sourceSnapshot.bytesRead,
                        destinationHash: copyResult.destinationHash,
                        staged: copyResult.staged,
                        fileSync: copyResult.fileSync,
                        destinationDirectorySync: copyResult.destinationDirectorySync,
                        destinationPreviousHash: destinationSnapshot?.contentHash ?? null,
                        destinationPreviousBytes: destinationSnapshot?.bytesRead ?? null,
                        destinationPreviousSnapshotBase64: destinationSnapshot?.snapshotBase64 ?? null,
                        destinationPreviousSnapshotTruncated: destinationSnapshot?.snapshotTruncated ?? false,
                        destinationPreviousRollbackSidecar: destinationSnapshot?.rollbackSidecar ?? null,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        invalidateIoCacheTiers(destination);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                bytesRead: value.sourceBytes,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass,
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    sourceHash: value.sourceHash,
                    destinationHash: value.destinationHash,
                    staged: value.staged,
                    fileSync: value.fileSync,
                    destinationDirectorySync: value.destinationDirectorySync,
                    overwrite: Boolean(options.overwrite),
                    destinationPreviousHash: value.destinationPreviousHash,
                    destinationRollbackSidecar: value.destinationPreviousRollbackSidecar
                        ? {
                              available: true,
                              bytes: value.destinationPreviousRollbackSidecar.bytes,
                              expiresAtMs: value.destinationPreviousRollbackSidecar.expiresAtMs,
                          }
                        : null,
                },
            }),
            true,
        );
        return {
            source,
            destination,
            bytesWritten: value.bytesWritten,
            sourceBytes: value.sourceBytes,
            sourceHash: value.sourceHash,
            destinationHash: value.destinationHash,
            staged: value.staged,
            fileSync: value.fileSync,
            destinationDirectorySync: value.destinationDirectorySync,
            destinationPreviousHash: value.destinationPreviousHash,
            destinationPreviousBytes: value.destinationPreviousBytes,
            destinationPreviousSnapshotBase64: value.destinationPreviousSnapshotBase64,
            destinationPreviousSnapshotTruncated: value.destinationPreviousSnapshotTruncated,
            destinationPreviousRollbackSidecar: value.destinationPreviousRollbackSidecar,
            lockWaitMs: waitMs,
            io,
        };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass,
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Move/rename com locks no source e destination.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string }} [options]
 */
export async function moveFileLocked(source, destination, options = {}) {
    assertValidIoFilePath(source);
    assertValidIoFilePath(destination);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const lease = await acquireIoResourceLocks([source, destination], {
            operation: 'move',
            target: destination,
            riskClass: 'high',
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    /**
                     * @type {{
                     *     contentHash: string;
                     *     bytesRead: number;
                     *     snapshotBase64: string | null;
                     *     snapshotTruncated: boolean;
                     *     rollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
                     * } | null}
                     */
                    let destinationSnapshot = null;
                    if (options.overwrite) {
                        destinationSnapshot = await readOptionalMutationSnapshot(destination, true);
                    } else {
                        await assertDestinationWritable(destination, options.overwrite);
                    }
                    const sourceSnapshot = await readMutationSnapshot(source);
                    await mkdirPathUnlocked(dirname(destination), { recursive: true });
                    const moveResult = await moveFileUnlocked(source, destination, {
                        overwrite: Boolean(options.overwrite),
                        expectedSourceHash: sourceSnapshot.contentHash,
                        expectedSourceBytes: sourceSnapshot.bytesRead,
                    });
                    return {
                        ...sourceSnapshot,
                        crossDevice: moveResult.crossDevice,
                        duplicatedAfterCrossDeviceMove: moveResult.duplicatedAfterCrossDeviceMove,
                        sourceUnlinkErrorCode: moveResult.sourceUnlinkErrorCode,
                        destinationHash: moveResult.destinationHash,
                        destinationBytes: moveResult.destinationBytes,
                        fileSync: moveResult.fileSync,
                        destinationDirectorySync: moveResult.destinationDirectorySync,
                        sourceDirectorySync: moveResult.sourceDirectorySync,
                        destinationPreviousHash: destinationSnapshot?.contentHash ?? null,
                        destinationPreviousBytes: destinationSnapshot?.bytesRead ?? null,
                        destinationPreviousSnapshotBase64: destinationSnapshot?.snapshotBase64 ?? null,
                        destinationPreviousSnapshotTruncated: destinationSnapshot?.snapshotTruncated ?? false,
                        destinationPreviousRollbackSidecar: destinationSnapshot?.rollbackSidecar ?? null,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        invalidateIoCacheTiers(source);
        invalidateIoCacheTiers(destination);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                bytesRead: value.bytesRead,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rename',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    sourceHash: value.contentHash,
                    overwrite: Boolean(options.overwrite),
                    destinationPreviousHash: value.destinationPreviousHash,
                    destinationRollbackSidecar: value.destinationPreviousRollbackSidecar
                        ? {
                              available: true,
                              bytes: value.destinationPreviousRollbackSidecar.bytes,
                              expiresAtMs: value.destinationPreviousRollbackSidecar.expiresAtMs,
                          }
                        : null,
                    crossDevice: value.crossDevice,
                    duplicatedAfterCrossDeviceMove: value.duplicatedAfterCrossDeviceMove,
                    sourceUnlinkErrorCode: value.sourceUnlinkErrorCode,
                    destinationHash: value.destinationHash,
                    destinationBytes: value.destinationBytes,
                    fileSync: value.fileSync,
                    destinationDirectorySync: value.destinationDirectorySync,
                    sourceDirectorySync: value.sourceDirectorySync,
                },
            }),
            true,
        );
        return {
            source,
            destination,
            sourceBytes: value.bytesRead,
            sourceHash: value.contentHash,
            destinationPreviousHash: value.destinationPreviousHash,
            destinationPreviousBytes: value.destinationPreviousBytes,
            destinationPreviousSnapshotBase64: value.destinationPreviousSnapshotBase64,
            destinationPreviousSnapshotTruncated: value.destinationPreviousSnapshotTruncated,
            destinationPreviousRollbackSidecar: value.destinationPreviousRollbackSidecar,
            crossDevice: value.crossDevice,
            duplicatedAfterCrossDeviceMove: value.duplicatedAfterCrossDeviceMove,
            sourceUnlinkErrorCode: value.sourceUnlinkErrorCode,
            destinationHash: value.destinationHash,
            destinationBytes: value.destinationBytes,
            fileSync: value.fileSync,
            destinationDirectorySync: value.destinationDirectorySync,
            sourceDirectorySync: value.sourceDirectorySync,
            lockWaitMs: waitMs,
            io,
        };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.rename',
                riskClass: 'high',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Patch textual com read + write dentro do mesmo lock.
 *
 * @param {string} filePath
 * @param {{
 *     oldString: string;
 *     newString: string;
 *     replaceAll?: boolean;
 *     expectedOccurrences?: number;
 *     occurrenceIndex?: number;
 *     expectedHash?: string;
 *     dryRun?: boolean;
 *     allowNoop?: boolean;
 *     diffContextLines?: number;
 *     maxDiffLines?: number;
 *     maxDiffBytes?: number;
 *     computeDiff?: boolean;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 */
export async function patchTextLocked(filePath, options) {
    assertValidIoFilePath(filePath);
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.dryRun ? 'low' : 'high';
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'patch',
            target: filePath,
            riskClass,
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const rawContent = await fs.readFile(filePath);
                    const rawBuffer = typeof rawContent === 'string' ? toOwnedBuffer(rawContent) : rawContent;
                    const content = typeof rawContent === 'string' ? rawContent : decodeUtf8Buffer(rawContent);
                    const previousHash = assertExpectedSha256(rawBuffer, options.expectedHash) ?? sha256(rawBuffer);
                    const patch = computeTextPatch(content, options);
                    const { updated, replacedOccurrences, bytesWritten } = patch;
                    const contentHash = sha256(updated);
                    const previousSnapshot = await buildRollbackSnapshot(rawBuffer, {
                        persistLarge: !options.dryRun,
                        contentHash: previousHash,
                    });
                    const diffContextLines = options.diffContextLines ?? DEFAULT_PATCH_DIFF_CONTEXT_LINES;
                    const shouldComputeDiff = options.computeDiff !== false;
                    const diff = shouldComputeDiff
                        ? buildSimpleTextDiff(content, updated, { contextLines: diffContextLines })
                        : { diff: '', contextLines: diffContextLines };
                    const diffPreview = shouldComputeDiff
                        ? windowTextPreview(diff.diff, {
                              maxLines: options.maxDiffLines ?? DEFAULT_PATCH_DIFF_MAX_LINES,
                              maxBytes: options.maxDiffBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES,
                          })
                        : { text: '', truncated: false, lines: 0, bytes: 0 };
                    if (!options.dryRun) {
                        await writeAtomicFileUnlocked(filePath, updated);
                    }
                    return {
                        occurrences: patch.occurrences,
                        replacedOccurrences,
                        bytesWritten: options.dryRun ? 0 : bytesWritten,
                        projectedBytes: bytesWritten,
                        previousBytes: patch.previousBytes,
                        byteDelta: patch.byteDelta,
                        oldStringBytes: patch.oldStringBytes,
                        newStringBytes: patch.newStringBytes,
                        firstMatchLine: patch.firstMatchLine,
                        lastMatchLine: patch.lastMatchLine,
                        lineDelta: patch.lineDelta,
                        occurrenceIndex: patch.occurrenceIndex,
                        noop: patch.noop,
                        diffPreview: diffPreview.text,
                        diffPreviewTruncated: diffPreview.truncated,
                        diffPreviewLines: diffPreview.lines,
                        diffPreviewBytes: diffPreview.bytes,
                        diffContextLines: diff.contextLines,
                        computeDiff: shouldComputeDiff,
                        previousHash,
                        contentHash,
                        dryRun: Boolean(options.dryRun),
                        previousSnapshotBase64: previousSnapshot.snapshotBase64,
                        previousSnapshotTruncated: previousSnapshot.snapshotTruncated,
                        previousRollbackSidecar: previousSnapshot.rollbackSidecar,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        if (!options.dryRun) invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass,
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    expectedHash: options.expectedHash ?? null,
                    contentHash: value.contentHash,
                    dryRun: Boolean(options.dryRun),
                    computeDiff: value.computeDiff,
                    occurrenceIndex: options.occurrenceIndex ?? null,
                    replaceAll: Boolean(options.replaceAll),
                    occurrences: value.occurrences,
                    replacedOccurrences: value.replacedOccurrences,
                    projectedBytes: value.projectedBytes,
                    byteDelta: value.byteDelta,
                    rollbackSidecar: value.previousRollbackSidecar
                        ? {
                              available: true,
                              bytes: value.previousRollbackSidecar.bytes,
                              expiresAtMs: value.previousRollbackSidecar.expiresAtMs,
                          }
                        : null,
                },
            }),
            true,
        );
        return { path: filePath, ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextLocked',
                riskClass,
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}
