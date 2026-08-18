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
import { assertExpectedSha256, assertExpectedSha256Digest } from '../../policy/preconditions.js';
import { decodeUtf8Buffer, toOwnedBuffer, utf8ByteLength } from '../../shared/buffer.js';
import { sha256 } from '../../shared/hash.js';
import { invalidateIoCacheTiers, invalidateIoCacheTierSubtrees } from '../invalidation/cache-tiers.js';
import { buildSimpleTextDiffAroundLineRange, computeTextPatch } from '../patch/index.js';
import { copyFileUnlocked } from './copy.js';
import { mkdirPathUnlocked } from './mkdir.js';
import { moveFileUnlocked } from './move.js';
import { deleteFileUnlocked, removePathUnlocked } from './remove.js';
import { persistRollbackSidecar, shouldCaptureIoRollback } from './rollback-sidecar.js';
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
    const snapshot = await readBinaryMutationSnapshot(filePath, {
        snapshotMaxBytes: captureRollback ? ROLLBACK_SNAPSHOT_MAX_BYTES : 0,
        rollbackSidecar: captureRollback,
    });
    return captureRollback
        ? snapshot
        : {
              ...snapshot,
              snapshotBase64: null,
              snapshotTruncated: false,
              rollbackSidecar: null,
          };
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
 * @param {unknown} error
 */
function isUnpublishedSnapshotConflict(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'EEXPECTEDHASH' || code === 'ESTALESNAPSHOT';
}

/**
 * @param {import('./rollback-sidecar.js').IoRollbackSidecar | null} sidecar
 */
async function discardRollbackSidecar(sidecar) {
    if (!sidecar) return;
    await fs.unlink(sidecar.path).catch(() => undefined);
}

/**
 * Remove arquivo com lock por path.
 *
 * @param {string} filePath
 * @param {{ expectedHash?: string; captureRollback?: boolean }} [options]
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
 *     rollbackCaptureEnabled: boolean;
 * }>}
 */
export async function deleteFileLocked(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const captureRollback = shouldCaptureIoRollback(options.captureRollback !== false);
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'delete',
            target: filePath,
            riskClass: 'high',
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const snapshot = await readMutationSnapshot(filePath, captureRollback);
                    assertExpectedSha256Digest(snapshot.contentHash, options.expectedHash);
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
                    rollbackCaptureEnabled: captureRollback,
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
                rollbackCaptureEnabled: captureRollback,
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
 * @param {{ recursive?: boolean; force?: boolean; recursiveConfirmation?: string; traceId?: string }} [options]
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
                removePathUnlocked(filePath, {
                    recursive: Boolean(options.recursive),
                    force: Boolean(options.force),
                    ...(options.recursiveConfirmation === undefined
                        ? {}
                        : { recursiveConfirmation: options.recursiveConfirmation }),
                }),
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
                    recursiveConfirmed: Boolean(options.recursive) && options.recursiveConfirmation === filePath,
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
 * @param {{ overwrite?: boolean; traceId?: string; expectedSourceHash?: string; captureRollback?: boolean }} [options]
 */
export async function copyFileLocked(source, destination, options = {}) {
    assertValidIoFilePath(source);
    assertValidIoFilePath(destination);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.overwrite ? 'high' : 'medium';
    const captureRollback = shouldCaptureIoRollback(options.overwrite === true && options.captureRollback !== false);
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
                        destinationSnapshot = await readOptionalMutationSnapshot(destination, captureRollback);
                    } else {
                        await assertDestinationWritable(destination, options.overwrite);
                    }
                    const sourceSnapshot = await readMutationSnapshot(source);
                    if (options.expectedSourceHash && sourceSnapshot.contentHash !== options.expectedSourceHash) {
                        const error = new Error(`Hash SHA-256 da origem diverge do esperado: ${source}`);
                        /** @type {{ code?: string }} */ (error).code = 'EEXPECTEDHASH';
                        throw error;
                    }
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
                        capacityPreflight: copyResult.capacityPreflight,
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
                    capacityPreflight: value.capacityPreflight,
                    overwrite: Boolean(options.overwrite),
                    destinationPreviousHash: value.destinationPreviousHash,
                    rollbackCaptureEnabled: captureRollback,
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
            capacityPreflight: value.capacityPreflight,
            destinationPreviousHash: value.destinationPreviousHash,
            destinationPreviousBytes: value.destinationPreviousBytes,
            destinationPreviousSnapshotBase64: value.destinationPreviousSnapshotBase64,
            destinationPreviousSnapshotTruncated: value.destinationPreviousSnapshotTruncated,
            destinationPreviousRollbackSidecar: value.destinationPreviousRollbackSidecar,
            rollbackCaptureEnabled: captureRollback,
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
 * @param {{ overwrite?: boolean; traceId?: string; expectedSourceHash?: string; captureRollback?: boolean }} [options]
 */
export async function moveFileLocked(source, destination, options = {}) {
    assertValidIoFilePath(source);
    assertValidIoFilePath(destination);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const captureRollback = shouldCaptureIoRollback(options.overwrite === true && options.captureRollback !== false);
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
                        destinationSnapshot = await readOptionalMutationSnapshot(destination, captureRollback);
                    } else {
                        await assertDestinationWritable(destination, options.overwrite);
                    }
                    const sourceSnapshot = await readMutationSnapshot(source);
                    assertExpectedSha256Digest(sourceSnapshot.contentHash, options.expectedSourceHash);
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
                        capacityPreflight: moveResult.capacityPreflight,
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
                    rollbackCaptureEnabled: captureRollback,
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
                    capacityPreflight: value.capacityPreflight,
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
            rollbackCaptureEnabled: captureRollback,
            crossDevice: value.crossDevice,
            duplicatedAfterCrossDeviceMove: value.duplicatedAfterCrossDeviceMove,
            sourceUnlinkErrorCode: value.sourceUnlinkErrorCode,
            destinationHash: value.destinationHash,
            destinationBytes: value.destinationBytes,
            fileSync: value.fileSync,
            destinationDirectorySync: value.destinationDirectorySync,
            sourceDirectorySync: value.sourceDirectorySync,
            capacityPreflight: value.capacityPreflight,
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
 * Apply several exact-text patches to one file under a single lock/read/write cycle. Operations are evaluated in order
 * against the virtual content produced by the previous operation, so same-file patch batches are atomic and can safely
 * depend on earlier replacements.
 *
 * @param {string} filePath
 * @param {{
 *     operations: Array<{
 *         oldString: string;
 *         newString: string;
 *         replaceAll?: boolean;
 *         expectedOccurrences?: number;
 *         occurrenceIndex?: number;
 *         expectedHash?: string;
 *         allowNoop?: boolean;
 *         diffContextLines?: number;
 *         maxDiffLines?: number;
 *         maxDiffBytes?: number;
 *         computeDiff?: boolean;
 *     }>;
 *     dryRun?: boolean;
 *     captureRollback?: boolean;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 */
export async function patchTextBatchLocked(filePath, options) {
    assertValidIoFilePath(filePath);
    if (!Array.isArray(options.operations) || options.operations.length === 0) {
        const error = /** @type {TypeError & { code?: string }} */ (new TypeError('patch batch requires operations'));
        error.code = 'ERR_PATCH_BATCH_EMPTY';
        throw error;
    }
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.dryRun ? 'low' : 'high';
    const captureRollback = shouldCaptureIoRollback(options.captureRollback !== false) && !options.dryRun;
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
                    const initialContent = typeof rawContent === 'string' ? rawContent : decodeUtf8Buffer(rawContent);
                    const previousHash = sha256(rawBuffer);
                    let currentContent = initialContent;
                    // Hash identity flows with the virtual content. Reusing H(n-1) as the next previousHash preserves
                    // every expectedHash precondition while avoiding a second full-content SHA pass per operation.
                    let currentHash = previousHash;
                    /** @type {Record<string, unknown>[]} */
                    const operations = [];

                    for (const [index, operation] of options.operations.entries()) {
                        const operationPreviousHash = currentHash;
                        assertExpectedSha256Digest(operationPreviousHash, operation.expectedHash);
                        const patch = computeTextPatch(currentContent, operation);
                        const updated = patch.updated;
                        const operationContentHash = patch.noop ? operationPreviousHash : sha256(updated);
                        const diffContextLines = operation.diffContextLines ?? DEFAULT_PATCH_DIFF_CONTEXT_LINES;
                        const shouldComputeDiff = operation.computeDiff === true;
                        const diff = shouldComputeDiff
                            ? buildSimpleTextDiffAroundLineRange(currentContent, updated, {
                                  firstMatchLine: patch.firstMatchLine,
                                  lastMatchLine: patch.lastMatchLine,
                                  lineDelta: patch.lineDelta,
                                  contextLines: diffContextLines,
                                  replacedOccurrences: patch.replacedOccurrences,
                              })
                            : { diff: '', contextLines: diffContextLines, rangeOptimized: false };
                        const diffPreview = shouldComputeDiff
                            ? windowTextPreview(diff.diff, {
                                  maxLines: operation.maxDiffLines ?? DEFAULT_PATCH_DIFF_MAX_LINES,
                                  maxBytes: operation.maxDiffBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES,
                              })
                            : { text: '', truncated: false, lines: 0, bytes: 0 };
                        operations.push({
                            index,
                            occurrences: patch.occurrences,
                            replacedOccurrences: patch.replacedOccurrences,
                            previousBytes: patch.previousBytes,
                            projectedBytes: patch.bytesWritten,
                            byteDelta: patch.byteDelta,
                            firstMatchLine: patch.firstMatchLine,
                            lastMatchLine: patch.lastMatchLine,
                            lineDelta: patch.lineDelta,
                            occurrenceIndex: patch.occurrenceIndex,
                            noop: patch.noop,
                            previousHash: operationPreviousHash,
                            contentHash: operationContentHash,
                            diffPreview: diffPreview.text,
                            diffPreviewTruncated: diffPreview.truncated,
                            diffPreviewLines: diffPreview.lines,
                            diffPreviewBytes: diffPreview.bytes,
                            diffContextLines: diff.contextLines,
                            diffRangeOptimized: diff.rangeOptimized === true,
                        });
                        currentContent = updated;
                        currentHash = operationContentHash;
                    }

                    const finalNoop = currentContent === initialContent;
                    const contentHash = currentHash;
                    const projectedBytes = utf8ByteLength(currentContent, 'patch batch result');
                    const previousSnapshot =
                        finalNoop || !captureRollback
                            ? { snapshotBase64: null, snapshotTruncated: false, rollbackSidecar: null }
                            : await buildRollbackSnapshot(rawBuffer, {
                                  persistLarge: true,
                                  contentHash: previousHash,
                              });
                    let durability = null;
                    if (!options.dryRun && !finalNoop) {
                        try {
                            durability = await writeAtomicFileUnlocked(filePath, currentContent, {
                                expectedHash: previousHash,
                                ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                                ...(options.durability === undefined ? {} : { durability: options.durability }),
                            });
                        } catch (error) {
                            if (isUnpublishedSnapshotConflict(error)) {
                                await discardRollbackSidecar(previousSnapshot.rollbackSidecar);
                            }
                            throw error;
                        }
                    }
                    return {
                        operations,
                        operationCount: operations.length,
                        previousBytes: rawBuffer.byteLength,
                        projectedBytes,
                        bytesWritten: options.dryRun || finalNoop ? 0 : projectedBytes,
                        byteDelta: projectedBytes - rawBuffer.byteLength,
                        previousHash,
                        contentHash,
                        noop: finalNoop,
                        dryRun: Boolean(options.dryRun),
                        rollbackCaptureEnabled: captureRollback,
                        previousSnapshotBase64: previousSnapshot.snapshotBase64,
                        previousSnapshotTruncated: previousSnapshot.snapshotTruncated,
                        previousRollbackSidecar: previousSnapshot.rollbackSidecar,
                        capacityPreflight: durability?.capacityPreflight ?? null,
                        durability,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        if (!options.dryRun && !value.noop) invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'patch',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.patchTextBatchLocked',
                riskClass,
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    operationCount: value.operationCount,
                    previousHash: value.previousHash,
                    contentHash: value.contentHash,
                    dryRun: Boolean(options.dryRun),
                    projectedBytes: value.projectedBytes,
                    byteDelta: value.byteDelta,
                    capacityPreflight: value.capacityPreflight,
                    durability: value.durability,
                    rollbackCaptureEnabled: value.rollbackCaptureEnabled,
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
                engine: 'io-engine.patchTextBatchLocked',
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
 * Patch textual com read + write dentro do mesmo lock e preview otimizado quando seguro.
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
 *     captureRollback?: boolean;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 * }} options
 */
export async function patchTextLocked(filePath, options) {
    assertValidIoFilePath(filePath);
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.dryRun ? 'low' : 'high';
    const captureRollback = shouldCaptureIoRollback(options.captureRollback !== false) && !options.dryRun;
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'patch',
            target: filePath,
            riskClass,
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const readStartedAt = nowIoMs();
                    const rawContent = await fs.readFile(filePath);
                    const readMs = elapsedMs(readStartedAt);
                    const rawBuffer = typeof rawContent === 'string' ? toOwnedBuffer(rawContent) : rawContent;
                    const content = typeof rawContent === 'string' ? rawContent : decodeUtf8Buffer(rawContent);
                    const previousHash = assertExpectedSha256(rawBuffer, options.expectedHash) ?? sha256(rawBuffer);
                    const patchStartedAt = nowIoMs();
                    const patch = computeTextPatch(content, options);
                    const patchMs = elapsedMs(patchStartedAt);
                    void readMs;
                    void patchMs;
                    const { updated, replacedOccurrences, bytesWritten } = patch;
                    const contentHash = sha256(updated);
                    const previousSnapshot =
                        patch.noop || !captureRollback
                            ? { snapshotBase64: null, snapshotTruncated: false, rollbackSidecar: null }
                            : await buildRollbackSnapshot(rawBuffer, {
                                  persistLarge: true,
                                  contentHash: previousHash,
                              });
                    const diffContextLines = options.diffContextLines ?? DEFAULT_PATCH_DIFF_CONTEXT_LINES;
                    const { firstMatchLine, lastMatchLine, lineDelta } = patch;
                    const shouldComputeDiff = options.computeDiff !== false;
                    const diff = shouldComputeDiff
                        ? buildSimpleTextDiffAroundLineRange(content, updated, { firstMatchLine, lastMatchLine, lineDelta, contextLines: diffContextLines, replacedOccurrences: replacedOccurrences })
                        : { diff: '', contextLines: diffContextLines, rangeOptimized: false };
                    const diffPreview = shouldComputeDiff
                        ? windowTextPreview(diff.diff, {
                              maxLines: options.maxDiffLines ?? DEFAULT_PATCH_DIFF_MAX_LINES,
                              maxBytes: options.maxDiffBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES,
                          })
                        : { text: '', truncated: false, lines: 0, bytes: 0 };
                    let durability = null;
                    if (!options.dryRun && !patch.noop) {
                        try {
                            durability = await writeAtomicFileUnlocked(filePath, updated, {
                                expectedHash: previousHash,
                                ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                                ...(options.durability === undefined ? {} : { durability: options.durability }),
                            });
                        } catch (error) {
                            if (isUnpublishedSnapshotConflict(error)) {
                                await discardRollbackSidecar(previousSnapshot.rollbackSidecar);
                            }
                            throw error;
                        }
                    }
                    return {
                        occurrences: patch.occurrences,
                        replacedOccurrences,
                        bytesWritten: options.dryRun || patch.noop ? 0 : bytesWritten,
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
                        diffRangeOptimized: diff.rangeOptimized === true,
                        computeDiff: shouldComputeDiff,
                        previousHash,
                        contentHash,
                        dryRun: Boolean(options.dryRun),
                        rollbackCaptureEnabled: captureRollback,
                        previousSnapshotBase64: previousSnapshot.snapshotBase64,
                        previousSnapshotTruncated: previousSnapshot.snapshotTruncated,
                        previousRollbackSidecar: previousSnapshot.rollbackSidecar,
                        capacityPreflight: durability?.capacityPreflight ?? null,
                        durability,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        if (!options.dryRun && !value.noop) invalidateIoCacheTiers(filePath);
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
                    diffRangeOptimized: value.diffRangeOptimized,
                    occurrenceIndex: options.occurrenceIndex ?? null,
                    replaceAll: Boolean(options.replaceAll),
                    occurrences: value.occurrences,
                    replacedOccurrences: value.replacedOccurrences,
                    projectedBytes: value.projectedBytes,
                    byteDelta: value.byteDelta,
                    capacityPreflight: value.capacityPreflight,
                    durability: value.durability,
                    rollbackCaptureEnabled: value.rollbackCaptureEnabled,
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
