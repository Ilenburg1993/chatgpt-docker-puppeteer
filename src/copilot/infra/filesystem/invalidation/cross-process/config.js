// @ts-check
/** Cross-process invalidation runtime configuration. */
import { booleanValueOr, boundedIntegerOr } from '#copilot/infra/internal/platform/config-values';

export const DEFAULT_CROSS_PROCESS_POLL_MS = 125;
const DEFAULT_BATCH_MAX = 256;
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] @returns {import('./types.js').CrossProcessInvalidationConfig} */
export function readCrossProcessInvalidationConfig(env = {}) {
    const isTestRuntime = env['VITEST'] === 'true' || env['NODE_ENV'] === 'test' || env['NODE_ENV'] === 'testing';
    return Object.freeze({
        enabled: booleanValueOr(env['IO_CROSS_PROCESS_INVALIDATION_ENABLED'], !isTestRuntime),
        pollMs: boundedIntegerOr(
            env['IO_CROSS_PROCESS_INVALIDATION_POLL_MS'],
            DEFAULT_CROSS_PROCESS_POLL_MS,
            25,
            5_000,
        ),
        batchMax: boundedIntegerOr(env['IO_CROSS_PROCESS_INVALIDATION_BATCH_MAX'], DEFAULT_BATCH_MAX, 1, 2_000),
        maxRows: boundedIntegerOr(env['IO_CROSS_PROCESS_INVALIDATION_MAX_ROWS'], DEFAULT_MAX_ROWS, 100, 100_000),
        retentionMs: boundedIntegerOr(
            env['IO_CROSS_PROCESS_INVALIDATION_RETENTION_MS'],
            DEFAULT_RETENTION_MS,
            10_000,
            24 * 60 * 60 * 1000,
        ),
        cleanupIntervalMs: boundedIntegerOr(
            env['IO_CROSS_PROCESS_INVALIDATION_CLEANUP_INTERVAL_MS'],
            DEFAULT_CLEANUP_INTERVAL_MS,
            1_000,
            60 * 60 * 1000,
        ),
    });
}
