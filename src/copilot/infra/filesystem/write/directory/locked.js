// @ts-check
/** Locked directory creation and namespace-durability orchestration. */

import { buildIoMeta, createIoTraceId, withIoMeta } from '#copilot/core';
import { withIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation';
import { mkdirPathUnlocked } from '#copilot/infra/internal/filesystem/transaction';
import { assertValidIoFilePath } from '#copilot/infra/internal/policy';
import { elapsedIoMs, nowIoMs, publishIoOperationResult } from '#copilot/infra/internal/telemetry';

/**
 * Cria diretório com lock por path, preservando a semântica do SDK SessionFsProvider.mkdir().
 *
 * @param {string} dirPath
 * @param {{
 *     recursive?: boolean;
 *     mode?: number;
 *     traceId?: string;
 *     durability?: import('#copilot/infra/internal/platform/node/filesystem').IoDurabilityMode;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 *     syncDirectory?: typeof import('#copilot/infra/internal/platform/node/filesystem').syncParentDirectoryBestEffort;
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
            for (const invalidationTarget of invalidationTargets) invalidateIoCoherencePath(invalidationTarget);
        }
        const io = publishIoOperationResult(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedIoMs(startedAt),
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
        publishIoOperationResult(
            buildIoMeta({
                operation: 'mkdir',
                target: dirPath,
                targetKind: 'directory',
                durationMs: elapsedIoMs(startedAt),
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
