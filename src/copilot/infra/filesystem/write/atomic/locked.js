// @ts-check
/** Locked atomic write/create-replace orchestration with rollback evidence. */

import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { readBinaryMutationSnapshot } from '#copilot/infra/internal/filesystem/transaction';
import { buildIoMeta, createIoTraceId } from '#copilot/infra/internal/operations/contracts';
import { sha256 } from '#copilot/infra/internal/platform/hash';
import { assertExpectedSha256Digest, assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdirPathLocked } from '../directory/index.js';
import { normalizeWritePayload } from '../payload/index.js';
import { writeAtomicOwnedBufferUnlocked } from './unlocked.js';

const ROLLBACK_SNAPSHOT_MAX_BYTES = 256 * 1024;

/**
 * @param {string} filePath
 * @param {unknown} error
 * @returns {Error}
 */
function normalizeCreateExclusiveError(filePath, error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    if (code !== 'EEXIST') return /** @type {Error} */ (error);
    const err = new Error(`Destino já existe: ${filePath}`);
    /** @type {{ code?: string; cause?: unknown }} */ (err).code = 'EEXIST';
    /** @type {{ code?: string; cause?: unknown }} */ (err).cause = error;
    return err;
}

/**
 * Escrita atômica central: tmp no mesmo diretório + rename. Usa lock por path real para evitar corrida intra-processo.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 *     traceId?: string;
 *     mode?: number;
 *     requireExists?: boolean;
 *     failIfExists?: boolean;
 *     expectedHash?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 *     captureRollback?: boolean;
 *     rollbackPolicy?: ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').readIoRollbackPolicy>;
 *     capacityPreflight?: typeof import('#copilot/infra/internal/filesystem/transaction').preflightIoCapacity;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     bytesWritten: number;
 *     io: import('#copilot/infra/internal/operations/contracts').IoMeta;
 *     lockWaitMs: number;
 *     previousHash: string | null;
 *     previousBytes: number | null;
 *     previousSnapshotBase64: string | null;
 *     previousSnapshotTruncated: boolean;
 *     previousRollbackSidecar: import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null;
 *     rollbackCaptureEnabled: boolean;
 *     contentHash: string;
 *     durability: Awaited<ReturnType<typeof writeAtomicOwnedBufferUnlocked>>;
 * }>}
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function writeFileAtomic(filePath, content, options = {}, invalidationBus = undefined) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    const contentHash = sha256(payload);
    const riskClass = options.riskClass ?? 'medium';
    const captureRollback = options.captureRollback ?? options.rollbackPolicy?.enabled ?? false;
    const rollbackCleanup = { path: /** @type {string | null} */ (null) };
    try {
        const lease = await acquireIoResourceLock(filePath, {
            ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            operation: 'write',
            target: filePath,
            riskClass,
        });
        const value = await (async () => {
            try {
                return await lease.run(async () => {
                    // Existence preconditions belong at the publish boundary. A preliminary access() here widened the
                    // TOCTOU window for requireExists and duplicated the atomic EEXIST check already provided by link().
                    let previousSnapshot =
                        /** @type {Awaited<ReturnType<typeof readBinaryMutationSnapshot>> | null} */ (null);
                    if (captureRollback || options.expectedHash) {
                        try {
                            previousSnapshot = await readBinaryMutationSnapshot(filePath, {
                                snapshotMaxBytes: captureRollback ? ROLLBACK_SNAPSHOT_MAX_BYTES : 0,
                                rollbackSidecar: captureRollback
                                    ? { ...(options.rollbackPolicy ? { policy: options.rollbackPolicy } : {}) }
                                    : false,
                            });
                            if (!captureRollback) {
                                previousSnapshot = {
                                    ...previousSnapshot,
                                    snapshotBase64: null,
                                    snapshotTruncated: false,
                                    rollbackSidecar: null,
                                };
                            }
                            rollbackCleanup.path = previousSnapshot.rollbackSidecar?.path ?? null;
                        } catch (error) {
                            const code = /** @type {{ code?: unknown }} */ (error)?.code;
                            if (
                                options.requireExists ||
                                options.expectedHash ||
                                (code !== 'ENOENT' && code !== 'ENOTDIR')
                            ) {
                                throw error;
                            }
                        }
                    }
                    assertExpectedSha256Digest(previousSnapshot?.contentHash ?? '', options.expectedHash);

                    const durability = await writeAtomicOwnedBufferUnlocked(filePath, payload, {
                        ...(options.mode === undefined ? {} : { mode: options.mode }),
                        exclusive: Boolean(options.failIfExists),
                        requireExists: Boolean(options.requireExists),
                        ...(previousSnapshot?.contentHash
                            ? { expectedHash: previousSnapshot.contentHash }
                            : options.expectedHash === undefined
                              ? {}
                              : { expectedHash: options.expectedHash }),
                        ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                        ...(options.durability === undefined ? {} : { durability: options.durability }),
                        ...(options.capacityPreflight === undefined
                            ? {}
                            : { capacityPreflight: options.capacityPreflight }),
                    });
                    return {
                        path: filePath,
                        bytesWritten: bytes,
                        previousHash: previousSnapshot?.contentHash ?? null,
                        previousBytes: previousSnapshot?.bytesRead ?? null,
                        previousSnapshotBase64: previousSnapshot?.snapshotBase64 ?? null,
                        previousSnapshotTruncated: previousSnapshot?.snapshotTruncated ?? false,
                        previousRollbackSidecar: previousSnapshot?.rollbackSidecar ?? null,
                        rollbackCaptureEnabled: captureRollback,
                        contentHash,
                        durability,
                    };
                });
            } finally {
                await lease.releaseAsync();
            }
        })();
        rollbackCleanup.path = null;
        const waitMs = lease.waitMs;
        invalidateIoCoherencePath(filePath, {}, invalidationBus);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass,
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    expectedHash: options.expectedHash ?? null,
                    contentHash,
                    rollbackCaptureEnabled: value.rollbackCaptureEnabled,
                    durability: value.durability,
                },
            }),
            true,
            undefined,
            getIoTelemetryRuntimeOption(options),
        );
        return { ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        if (rollbackCleanup.path) {
            await fs.unlink(rollbackCleanup.path).catch(() => undefined);
        }
        const finalError = options.failIfExists ? normalizeCreateExclusiveError(filePath, error) : error;
        publishIoOperationResult(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass,
                traceId,
            }),
            false,
            finalError,
            getIoTelemetryRuntimeOption(options),
        );
        throw finalError;
    }
}

/**
 * Garante diretório pai e escreve de forma atômica.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {Parameters<typeof writeFileAtomic>[2] & { createParentDirs?: boolean }} [options]
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function createOrReplaceFileAtomic(filePath, content, options = {}, invalidationBus = undefined) {
    assertValidIoFilePath(filePath);
    if (options.createParentDirs !== false) {
        await mkdirPathLocked(
            dirname(filePath),
            {
                recursive: true,
                advisoryLimits: {
                    operation: 'createOrReplaceFileAtomic.parentMkdir',
                },
            },
            invalidationBus,
        );
    }
    return writeFileAtomic(filePath, content, options, invalidationBus);
}
