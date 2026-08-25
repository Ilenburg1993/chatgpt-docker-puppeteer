// @ts-check
import { acquireIoResourceLocks } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { mkdirPathUnlocked } from '#copilot/infra/internal/filesystem/transaction';
import { moveFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { buildIoMeta, createIoTraceId } from '#copilot/infra/internal/operations/contracts';
import { assertExpectedSha256Digest, assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { dirname } from 'node:path';
import { assertDestinationWritable, readMutationSnapshot, readOptionalMutationSnapshot } from '../rollback/index.js';

/**
 * Move/rename com locks no source e destination.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string; expectedSourceHash?: string; captureRollback?: boolean; rollbackPolicy?: ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').readIoRollbackPolicy>; capacityPreflight?: typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity; signal?: AbortSignal }} [options]
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function moveFileLocked(source, destination, options = {}, invalidationBus = undefined) {
    assertValidIoFilePath(source);
    assertValidIoFilePath(destination);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const captureRollback =
        options.overwrite === true && (options.captureRollback ?? options.rollbackPolicy?.enabled ?? false);
    try {
        const lease = await acquireIoResourceLocks([source, destination], {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
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
                        destinationSnapshot = await readOptionalMutationSnapshot(
                            destination,
                            captureRollback,
                            options.rollbackPolicy,
                        );
                    } else {
                        await assertDestinationWritable(destination, options.overwrite);
                    }
                    const sourceSnapshot = await readMutationSnapshot(source);
                    options.signal?.throwIfAborted();
                    assertExpectedSha256Digest(sourceSnapshot.contentHash, options.expectedSourceHash);
                    await mkdirPathUnlocked(dirname(destination), { recursive: true });
                    options.signal?.throwIfAborted();
                    const moveResult = await moveFileUnlocked(source, destination, {
                        overwrite: Boolean(options.overwrite),
                        expectedSourceHash: sourceSnapshot.contentHash,
                        expectedSourceBytes: sourceSnapshot.bytesRead,
                        ...(options.capacityPreflight === undefined
                            ? {}
                            : { capacityPreflight: options.capacityPreflight }),
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
        invalidateIoCoherencePath(source, {}, invalidationBus);
        invalidateIoCoherencePath(destination, {}, invalidationBus);
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
            undefined,
            getIoTelemetryRuntimeOption(options),
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
            getIoTelemetryRuntimeOption(options),
        );
        throw error;
    }
}
