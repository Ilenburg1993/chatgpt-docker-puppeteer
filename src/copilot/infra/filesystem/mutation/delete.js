// @ts-check
/** Locked delete/remove operations. */

import { buildIoMeta, createIoTraceId, withIoMeta } from '#copilot/core/io-contracts';
import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import {
    invalidateIoCoherencePath,
    invalidateIoCoherenceSubtree,
} from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { deleteFileUnlocked, removePathUnlocked } from '#copilot/infra/internal/filesystem/write';
import { assertExpectedSha256Digest, assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { readMutationSnapshot } from './rollback/index.js';

/**
 * Remove arquivo com lock por path.
 *
 * @param {string} filePath
 * @param {{
 *     expectedHash?: string;
 *     captureRollback?: boolean;
 *     rollbackPolicy?: ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').readIoRollbackPolicy>;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 *     previousHash: string;
 *     previousBytes: number;
 *     previousSnapshotBase64: string | null;
 *     previousSnapshotTruncated: boolean;
 *     previousRollbackSidecar: import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null;
 *     rollbackCaptureEnabled: boolean;
 *     durability: Awaited<ReturnType<typeof deleteFileUnlocked>>;
 * }>}
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function deleteFileLocked(filePath, options = {}, invalidationBus = undefined) {
    assertValidIoFilePath(filePath);
    const traceId = createIoTraceId();
    const startedAt = nowIoMs();
    const captureRollback = options.captureRollback ?? options.rollbackPolicy?.enabled ?? false;
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'delete',
            target: filePath,
            riskClass: 'high',
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    const snapshot = await readMutationSnapshot(filePath, captureRollback, options.rollbackPolicy);
                    assertExpectedSha256Digest(snapshot.contentHash, options.expectedHash);
                    const durability = await deleteFileUnlocked(filePath, {
                        ...(options.durability === undefined ? {} : { durability: options.durability }),
                        ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                    });
                    return { ...snapshot, durability };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        const waitMs = lease.waitMs;
        invalidateIoCoherencePath(filePath, {}, invalidationBus);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                bytesRead: value.bytesRead,
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.unlink',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    previousHash: value.contentHash,
                    rollbackCaptureEnabled: captureRollback,
                    durability: value.durability,
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
            undefined,
            getIoTelemetryRuntimeOption(options),
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
                durability: value.durability,
            },
            io,
        );
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.unlink',
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

/**
 * Remove arquivo ou diretório com lock por path.
 *
 * @param {string} filePath
 * @param {{
 *     recursive?: boolean;
 *     force?: boolean;
 *     recursiveConfirmation?: string;
 *     traceId?: string;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     deleted: true;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 *     durability: Awaited<ReturnType<typeof removePathUnlocked>>;
 * }>}
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function removePathLocked(filePath, options = {}, invalidationBus = undefined) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'delete',
            target: filePath,
            riskClass: 'high',
        });
        let durability;
        try {
            durability = await lease.run(async () =>
                removePathUnlocked(filePath, {
                    recursive: Boolean(options.recursive),
                    force: Boolean(options.force),
                    ...(options.recursiveConfirmation === undefined
                        ? {}
                        : { recursiveConfirmation: options.recursiveConfirmation }),
                    ...(options.durability === undefined ? {} : { durability: options.durability }),
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                }),
            );
        } finally {
            await lease.releaseAsync();
        }
        const waitMs = lease.waitMs;
        invalidateIoCoherenceSubtree(filePath, {}, invalidationBus);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.rm',
                riskClass: 'high',
                traceId,
                advisoryLimits: {
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                    recursiveConfirmed: Boolean(options.recursive) && options.recursiveConfirmation === filePath,
                    force: Boolean(options.force),
                    durability,
                },
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return withIoMeta({ path: filePath, deleted: /** @type {const} */ (true), lockWaitMs: waitMs, durability }, io);
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'delete',
                target: filePath,
                targetKind: 'unknown',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.rm',
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
