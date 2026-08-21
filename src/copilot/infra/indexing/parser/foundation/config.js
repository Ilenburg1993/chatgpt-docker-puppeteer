// @ts-check
/** Parser runtime/cache configuration and adaptive worker policies. */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { availableParallelism } from 'node:os';

export const MAX_PARSE_BYTES = Number(process.env['IO_PARSER_MAX_BYTES'] ?? 2 * 1024 * 1024);
export const MAX_PARSE_DURATION_MS = Number(process.env['IO_PARSER_MAX_DURATION_MS'] ?? 150);
export const MAX_PARSE_LINE_GUARD = Number(process.env['IO_PARSER_MAX_LINES'] ?? 30_000);
export const PARSER_WORKER_ENABLED = String(process.env['IO_PARSER_WORKER_ENABLED'] ?? '1').trim() !== '0';

/** @param {NodeJS.ProcessEnv} [env] @param {number} [parallelism] */
export function resolveParserWorkerPoolPolicy(env = process.env, parallelism = availableParallelism()) {
    const normalizedParallelism = Number.isFinite(parallelism) && parallelism >= 1 ? Math.floor(parallelism) : 1;
    const adaptiveSize = Math.max(1, Math.min(4, normalizedParallelism - 1));
    const configured = String(env['IO_PARSER_WORKER_POOL_SIZE'] ?? '').trim();
    if (!configured)
        return {
            size: adaptiveSize,
            source: /** @type {const} */ ('adaptive'),
            availableParallelism: normalizedParallelism,
        };
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 1)
        return {
            size: adaptiveSize,
            source: /** @type {const} */ ('adaptive'),
            availableParallelism: normalizedParallelism,
        };
    return {
        size: Math.min(16, Math.floor(parsed)),
        source: /** @type {const} */ ('configured'),
        availableParallelism: normalizedParallelism,
    };
}

export const PARSER_WORKER_POOL_POLICY = resolveParserWorkerPoolPolicy();
export const PARSER_WORKER_POOL_SIZE = PARSER_WORKER_POOL_POLICY.size;

/** @param {NodeJS.ProcessEnv} [env] @param {number} [poolSize] */
export function resolveParserWorkerQueuePolicy(env = process.env, poolSize = PARSER_WORKER_POOL_SIZE) {
    const normalizedPoolSize = Number.isFinite(poolSize) && poolSize >= 1 ? Math.floor(poolSize) : 1;
    const adaptiveMax = Math.max(16, normalizedPoolSize * 32);
    const configured = String(env['IO_PARSER_WORKER_QUEUE_MAX'] ?? '').trim();
    if (!configured) return { max: adaptiveMax, source: /** @type {const} */ ('adaptive') };
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 0) return { max: adaptiveMax, source: /** @type {const} */ ('adaptive') };
    return { max: Math.min(10_000, Math.floor(parsed)), source: /** @type {const} */ ('configured') };
}

export const PARSER_WORKER_QUEUE_POLICY = resolveParserWorkerQueuePolicy(process.env, PARSER_WORKER_POOL_SIZE);
export const PARSER_WORKER_QUEUE_MAX = PARSER_WORKER_QUEUE_POLICY.max;
export const PARSER_WORKER_REQUEST_TIMEOUT_MS = Math.max(
    MAX_PARSE_DURATION_MS,
    Number(process.env['IO_PARSER_WORKER_REQUEST_TIMEOUT_MS'] ?? 500),
);
export const PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES = readEnvPositiveInt(
    'IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES',
    128 * 1024,
);
export const PARSER_WORKER_RESTART_BACKOFF_MS = Object.freeze([100, 250, 500, 1_000, 2_000, 5_000]);
export const SYMBOL_CACHE_MAX_ENTRIES = readEnvPositiveInt('IO_PARSER_SYMBOL_CACHE_MAX_ENTRIES', 500);
export const SYMBOL_CACHE_MAX_BYTES = readEnvPositiveInt('IO_PARSER_SYMBOL_CACHE_MAX_BYTES', 64 * 1024 * 1024);
export const FILE_CONTEXT_CACHE_MAX_ENTRIES = readEnvPositiveInt('IO_PARSER_FILE_CONTEXT_CACHE_MAX_ENTRIES', 256);
export const FILE_CONTEXT_CACHE_MAX_BYTES = readEnvPositiveInt(
    'IO_PARSER_FILE_CONTEXT_CACHE_MAX_BYTES',
    64 * 1024 * 1024,
);
export const FILE_CONTEXT_CACHE_TTL_MS = Number(process.env['IO_PARSER_FILE_CONTEXT_CACHE_TTL_MS'] ?? 5 * 60_000);
export const FILE_CONTEXT_CACHE_DISABLED_VALUES = Object.freeze(new Set(['0', 'false', 'off', 'disabled']));
