// @ts-check
import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { acquireIoResourceLocks } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { mkdirPathUnlocked } from '#copilot/infra/internal/filesystem/transaction';
import { copyFileUnlocked } from '#copilot/infra/internal/filesystem/write';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { dirname } from 'node:path';
import { assertDestinationWritable, readMutationSnapshot, readOptionalMutationSnapshot } from '../rollback/index.js';

/**
 * Copia arquivo com lock no destino.
 *
 * @param {string} source
 * @param {string} destination
 * @param {{ overwrite?: boolean; traceId?: string; expectedSourceHash?: string; captureRollback?: boolean; rollbackPolicy?: ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').readIoRollbackPolicy>; capacityPreflight?: typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity }} [options]
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function copyFileLocked(source, destination, options = {}, invalidationBus = undefined) {
    assertValidIoFilePath(source);
    assertValidIoFilePath(destination);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.overwrite ? 'high' : 'medium';
    const captureRollback =
        options.overwrite === true && (options.captureRollback ?? options.rollbackPolicy?.enabled ?? false);
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
                        ...(options.capacityPreflight === undefined
                            ? {}
                            : { capacityPreflight: options.capacityPreflight }),
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
        invalidateIoCoherencePath(destination, {}, invalidationBus);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                bytesRead: value.sourceBytes,
                durationMs: elapsedIoMs(startedAt),
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
            undefined,
            getIoTelemetryRuntimeOption(options),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'copy',
                target: `${source} -> ${destination}`,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.copyFile',
                riskClass,
                traceId,
            }),
            false,
            error,
            getIoTelemetryRuntimeOption(options),
        );
        throw error;
    }
}
