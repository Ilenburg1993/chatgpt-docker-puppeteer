// @ts-check
import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { acquireIoResourceLocks } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation';
import { mkdirPathUnlocked, shouldCaptureIoRollback } from '#copilot/infra/internal/filesystem/transaction';
import { moveFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { assertExpectedSha256Digest, assertValidIoFilePath } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import { dirname } from 'node:path';
import { assertDestinationWritable, readMutationSnapshot, readOptionalMutationSnapshot } from '../rollback/index.js';

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
                     *     rollbackSidecar: import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null;
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
        invalidateIoCoherencePath(source);
        invalidateIoCoherencePath(destination);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                bytesRead: value.bytesRead,
                durationMs: elapsedIoMs(startedAt),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'move',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
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
