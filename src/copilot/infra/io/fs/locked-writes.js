// @ts-check
/**
 * Escritas e mkdir protegidos por lock por recurso.
 *
 * Extraído do `io-engine` para reduzir acoplamento e manter a facade pública estável.
 *
 * @module copilot/infra/io/fs/locked-writes
 */

import { buildIoMeta, createIoTraceId, withIoMeta } from '#copilot/core';
import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { acquireIoResourceLock, withIoResourceLock } from '../../io-locks.js';
import { nowIoMs, publishIoOperation } from '../../io-observability.js';
import { assertValidIoFilePath } from '../../policy/path-resource.js';
import { assertExpectedSha256Digest } from '../../policy/preconditions.js';
import { sha256 } from '../../shared/hash.js';
import { invalidateIoCacheTiers } from '../invalidation/cache-tiers.js';
import { openDetachedAppendSinkUnlocked } from './append-sink.js';
import { appendFileUnlocked } from './append.js';
import { chmodFileUnlocked } from './metadata.js';
import { mkdirPathUnlocked } from './mkdir.js';
import { shouldCaptureIoRollback } from './rollback-sidecar.js';
import { readBinaryMutationSnapshot } from './snapshot.js';
import { normalizeWritePayload, writeAtomicOwnedBufferUnlocked } from './write-atomic.js';

const ROLLBACK_SNAPSHOT_MAX_BYTES = 256 * 1024;

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
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 *     traceId?: string;
 *     mode?: number;
 *     requireExists?: boolean;
 *     failIfExists?: boolean;
 *     expectedHash?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 *     captureRollback?: boolean;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     bytesWritten: number;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 *     previousHash: string | null;
 *     previousBytes: number | null;
 *     previousSnapshotBase64: string | null;
 *     previousSnapshotTruncated: boolean;
 *     previousRollbackSidecar: import('./rollback-sidecar.js').IoRollbackSidecar | null;
 *     rollbackCaptureEnabled: boolean;
 *     contentHash: string;
 *     durability: Awaited<ReturnType<typeof writeAtomicOwnedBufferUnlocked>>;
 * }>}
 */
export async function writeFileAtomic(filePath, content, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    const contentHash = sha256(payload);
    const riskClass = options.riskClass ?? 'medium';
    const captureRollback = shouldCaptureIoRollback(options.captureRollback === true);
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
                                rollbackSidecar: captureRollback,
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
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                bytesWritten: value.bytesWritten,
                durationMs: elapsedMs(startedAt),
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
        );
        return { ...value, lockWaitMs: waitMs, io };
    } catch (error) {
        if (rollbackCleanup.path) {
            await fs.unlink(rollbackCleanup.path).catch(() => undefined);
        }
        const finalError = options.failIfExists ? normalizeCreateExclusiveError(filePath, error) : error;
        publishAndReturn(
            buildIoMeta({
                operation: 'write',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.atomic-write',
                riskClass,
                traceId,
            }),
            false,
            finalError,
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
 */
export async function createOrReplaceFileAtomic(filePath, content, options = {}) {
    assertValidIoFilePath(filePath);
    if (options.createParentDirs !== false) {
        await mkdirPathLocked(dirname(filePath), {
            recursive: true,
            advisoryLimits: {
                operation: 'createOrReplaceFileAtomic.parentMkdir',
            },
        });
    }
    return writeFileAtomic(filePath, content, options);
}

/**
 * Append com lock por path. Mantém append separado de write para observabilidade e política de risco.
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{
 *     encoding?: BufferEncoding;
 *     mode?: number;
 *     traceId?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     bytesWritten: number;
 *     lockWaitMs: number;
 *     durability: Awaited<ReturnType<typeof appendFileUnlocked>>;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 * }>}
 */
export async function appendTextLocked(filePath, content, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const { payload, bytes } = normalizeWritePayload(filePath, content, options.encoding ?? 'utf8');
    try {
        const lease = await acquireIoResourceLock(filePath, {
            ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            operation: 'append',
            target: filePath,
            riskClass: 'medium',
        });
        let durability;
        try {
            durability = await lease.run(async () =>
                appendFileUnlocked(filePath, payload, {
                    ...(options.mode === undefined ? {} : { mode: options.mode }),
                    ...(options.durability === undefined ? {} : { durability: options.durability }),
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                }),
            );
        } finally {
            await lease.releaseAsync();
        }
        const waitMs = lease.waitMs;
        invalidateIoCacheTiers(filePath);
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                bytesWritten: bytes,
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    durability,
                },
            }),
            true,
        );
        return { path: filePath, bytesWritten: bytes, lockWaitMs: waitMs, durability, io };
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.appendFile',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}

/**
 * Opens an append-only descriptor intended to be inherited by a detached child. The resource lock covers creation/open
 * and namespace durability; writes after descriptor inheritance are intentionally owned by the child process.
 *
 * @param {string} filePath
 * @param {{
 *     mode?: number;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 */
export async function openDetachedAppendSinkLocked(filePath, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.riskClass ?? 'medium';
    try {
        const lease = await acquireIoResourceLock(filePath, {
            operation: 'append',
            target: filePath,
            riskClass,
        });
        try {
            const value = await lease.run(() =>
                openDetachedAppendSinkUnlocked(filePath, {
                    ...(options.mode === undefined ? {} : { mode: options.mode }),
                    ...(options.durability === undefined ? {} : { durability: options.durability }),
                }),
            );
            if (value.created) invalidateIoCacheTiers(filePath);
            const io = publishAndReturn(
                buildIoMeta({
                    operation: 'append',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedMs(startedAt),
                    engine: 'io-engine.fs.detached-append-sink',
                    riskClass,
                    traceId,
                    advisoryLimits: {
                        ...(options.advisoryLimits ?? {}),
                        lockWaitMs: lease.waitMs,
                        created: value.created,
                        inheritedDescriptor: true,
                        durability: {
                            durability: value.durability,
                            directorySync: value.directorySync,
                        },
                    },
                }),
                true,
            );
            return { ...value, lockWaitMs: lease.waitMs, io };
        } finally {
            await lease.releaseAsync();
        }
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.detached-append-sink',
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
 * Applies a metadata-only chmod under the canonical resource lock. Content is never rewritten; when mode changes the
 * inode is invalidated across IO cache/index/scope tiers and durability metadata is published with operation=metadata.
 *
 * @param {string} filePath
 * @param {number} mode
 * @param {{
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 *     traceId?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 */
export async function chmodFileLocked(filePath, mode, options = {}) {
    assertValidIoFilePath(filePath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    const riskClass = options.riskClass ?? 'medium';
    try {
        const lease = await acquireIoResourceLock(filePath, {
            ...(options.lockTimeoutMs === undefined ? {} : { timeoutMs: options.lockTimeoutMs }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            operation: 'metadata',
            target: filePath,
            riskClass,
        });
        try {
            const value = await lease.run(() =>
                chmodFileUnlocked(filePath, mode, {
                    ...(options.durability === undefined ? {} : { durability: options.durability }),
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                }),
            );
            if (value.changed) invalidateIoCacheTiers(filePath);
            const io = publishAndReturn(
                buildIoMeta({
                    operation: 'metadata',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedMs(startedAt),
                    engine: 'io-engine.fs.chmod',
                    riskClass,
                    traceId,
                    advisoryLimits: {
                        ...(options.advisoryLimits ?? {}),
                        lockWaitMs: lease.waitMs,
                        changed: value.changed,
                        previousMode: value.previousMode,
                        mode: value.mode,
                        durability: {
                            ...value.durability,
                            fileFlushRequested: value.changed && value.durability.fileSync !== null,
                        },
                    },
                }),
                true,
            );
            return { ...value, lockWaitMs: lease.waitMs, io };
        } finally {
            await lease.releaseAsync();
        }
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'metadata',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.chmod',
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
 * Cria diretório com lock por path, preservando a semântica do SDK SessionFsProvider.mkdir().
 *
 * @param {string} dirPath
 * @param {{
 *     recursive?: boolean;
 *     mode?: number;
 *     traceId?: string;
 *     durability?: import('./durability.js').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof import('./durability.js').syncParentDirectoryBestEffort;
 *     advisoryLimits?: Record<string, unknown>;
 * }} [options]
 * @returns {Promise<{
 *     path: string;
 *     created: boolean;
 *     createdPath: string | undefined;
 *     io: import('#copilot/core/io-contracts').IoMeta;
 *     lockWaitMs: number;
 *     durability: Awaited<ReturnType<typeof mkdirPathUnlocked>>['durability'];
 * }>}
 */
export async function mkdirPathLocked(dirPath, options = {}) {
    assertValidIoFilePath(dirPath);
    const traceId = options.traceId ?? createIoTraceId();
    const startedAt = nowIoMs();
    try {
        const { value: mkdirResult, waitMs } = await withIoResourceLock(
            dirPath,
            async () =>
                mkdirPathUnlocked(dirPath, {
                    recursive: Boolean(options.recursive),
                    ...(options.mode === undefined ? {} : { mode: options.mode }),
                    ...(options.durability === undefined ? {} : { durability: options.durability }),
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                    ...(options.syncDirectory === undefined ? {} : { syncDirectory: options.syncDirectory }),
                }),
            { operation: 'mkdir', target: dirPath, riskClass: 'medium' },
        );
        if (mkdirResult.created) {
            const invalidationTargets = new Set([
                dirPath,
                ...mkdirResult.durability.directorySyncs.map((entry) => entry.target),
            ]);
            for (const invalidationTarget of invalidationTargets) invalidateIoCacheTiers(invalidationTarget);
        }
        const io = publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
                advisoryLimits: {
                    ...(options.advisoryLimits ?? {}),
                    lockWaitMs: waitMs,
                    recursive: Boolean(options.recursive),
                    created: mkdirResult.created,
                    createdPath: mkdirResult.createdPath ?? null,
                    durability: mkdirResult.durability,
                },
            }),
            true,
        );
        return withIoMeta(
            {
                path: dirPath,
                created: mkdirResult.created,
                createdPath: mkdirResult.createdPath,
                lockWaitMs: waitMs,
                durability: mkdirResult.durability,
            },
            io,
        );
    } catch (error) {
        publishAndReturn(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedMs(startedAt),
                engine: 'io-engine.fs.mkdir',
                riskClass: 'medium',
                traceId,
            }),
            false,
            error,
        );
        throw error;
    }
}
