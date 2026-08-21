// @ts-check
/** Locked append operations, including detached inherited append descriptors. */

import { buildIoMeta, createIoTraceId } from '#copilot/core';
import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';
import { normalizeWritePayload } from '../payload/index.js';
import { openDetachedAppendSinkUnlocked } from './sink.js';
import { appendFileUnlocked } from './unlocked.js';

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
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
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
        invalidateIoCoherencePath(filePath);
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                bytesWritten: bytes,
                durationMs: elapsedIoMs(startedAt),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
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
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
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
            if (value.created) invalidateIoCoherencePath(filePath);
            const io = publishIoOperationResult(
                buildIoMeta({
                    operation: 'append',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedIoMs(startedAt),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'append',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
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
