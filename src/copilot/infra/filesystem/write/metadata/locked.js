// @ts-check
/** Locked metadata-only filesystem writes. */

import { acquireIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { buildIoMeta, createIoTraceId } from '#copilot/infra/internal/operations/contracts';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import {
    elapsedIoMs,
    getIoTelemetryRuntimeOption,
    nowIoMs,
    publishIoOperationResult,
} from '#copilot/infra/internal/telemetry';
import { chmodFileUnlocked } from './unlocked.js';

/**
 * Applies a metadata-only chmod under the canonical resource lock. Content is never rewritten; when mode changes the
 * inode is invalidated across IO cache/index/scope tiers and durability metadata is published with operation=metadata.
 *
 * @param {string} filePath
 * @param {number} mode
 * @param {{
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
 *     traceId?: string;
 *     lockTimeoutMs?: number;
 *     signal?: AbortSignal;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     advisoryLimits?: Record<string, unknown>;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @param {ReturnType<typeof import('#copilot/infra/internal/filesystem/invalidation/bus').createIoInvalidationBusRuntime>} [invalidationBus]
 */
export async function chmodFileLocked(filePath, mode, options = {}, invalidationBus = undefined) {
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
            if (value.changed) invalidateIoCoherencePath(filePath, {}, invalidationBus);
            const io = publishIoOperationResult(
                buildIoMeta({
                    operation: 'metadata',
                    target: filePath,
                    targetKind: 'file',
                    durationMs: elapsedIoMs(startedAt),
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
                undefined,
                getIoTelemetryRuntimeOption(options),
            );
            return { ...value, lockWaitMs: lease.waitMs, io };
        } finally {
            await lease.releaseAsync();
        }
    } catch (error) {
        publishIoOperationResult(
            buildIoMeta({
                operation: 'metadata',
                target: filePath,
                targetKind: 'file',
                durationMs: elapsedIoMs(startedAt),
                engine: 'io-engine.fs.chmod',
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
