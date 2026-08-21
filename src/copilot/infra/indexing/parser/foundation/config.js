// @ts-check
/** Process-owned parser configuration and adaptive worker policies. */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform';
import { availableParallelism } from 'node:os';

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] @param {number} [parallelism] */
export function resolveParserWorkerPoolPolicy(env = {}, parallelism = availableParallelism()) {
    const normalizedParallelism = Number.isFinite(parallelism) && parallelism >= 1 ? Math.floor(parallelism) : 1;
    const adaptiveSize = Math.max(1, Math.min(4, normalizedParallelism - 1));
    const configured = String(env['IO_PARSER_WORKER_POOL_SIZE'] ?? '').trim();
    if (!configured)
        return Object.freeze({
            size: adaptiveSize,
            source: /** @type {const} */ ('adaptive'),
            availableParallelism: normalizedParallelism,
        });
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 1)
        return Object.freeze({
            size: adaptiveSize,
            source: /** @type {const} */ ('adaptive'),
            availableParallelism: normalizedParallelism,
        });
    return Object.freeze({
        size: Math.min(16, Math.floor(parsed)),
        source: /** @type {const} */ ('configured'),
        availableParallelism: normalizedParallelism,
    });
}

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] @param {number} [poolSize] */
export function resolveParserWorkerQueuePolicy(env = {}, poolSize = 1) {
    const normalizedPoolSize = Number.isFinite(poolSize) && poolSize >= 1 ? Math.floor(poolSize) : 1;
    const adaptiveMax = Math.max(16, normalizedPoolSize * 32);
    const configured = String(env['IO_PARSER_WORKER_QUEUE_MAX'] ?? '').trim();
    if (!configured) return Object.freeze({ max: adaptiveMax, source: /** @type {const} */ ('adaptive') });
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed < 0)
        return Object.freeze({ max: adaptiveMax, source: /** @type {const} */ ('adaptive') });
    return Object.freeze({ max: Math.min(10_000, Math.floor(parsed)), source: /** @type {const} */ ('configured') });
}

/**
 * Resolve the parser's genuinely process-scoped configuration from one explicit bootstrap environment.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @param {number} [parallelism]
 */
export function readParserProcessConfig(env, parallelism = availableParallelism()) {
    const poolPolicy = resolveParserWorkerPoolPolicy(env, parallelism);
    const queuePolicy = resolveParserWorkerQueuePolicy(env, poolPolicy.size);
    const maxParseDurationMs = readEnvPositiveInt('IO_PARSER_MAX_DURATION_MS', 150, env);
    return Object.freeze({
        maxParseBytes: readEnvPositiveInt('IO_PARSER_MAX_BYTES', 2 * 1024 * 1024, env),
        maxParseDurationMs,
        maxParseLines: readEnvPositiveInt('IO_PARSER_MAX_LINES', 30_000, env),
        workerEnabled: String(env['IO_PARSER_WORKER_ENABLED'] ?? '1').trim() !== '0',
        workerPoolPolicy: poolPolicy,
        workerQueuePolicy: queuePolicy,
        workerRequestTimeoutMs: Math.max(
            maxParseDurationMs,
            readEnvPositiveInt('IO_PARSER_WORKER_REQUEST_TIMEOUT_MS', 500, env),
        ),
        mainThreadFallbackMaxBytes: readEnvPositiveInt('IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES', 128 * 1024, env),
    });
}

// Parser workers are a ProcessInfra capability. Capture their policy once when the process loads the parser foundation.
const PROCESS_PARSER_CONFIG = readParserProcessConfig(process.env);

export const MAX_PARSE_BYTES = PROCESS_PARSER_CONFIG.maxParseBytes;
export const MAX_PARSE_DURATION_MS = PROCESS_PARSER_CONFIG.maxParseDurationMs;
export const MAX_PARSE_LINE_GUARD = PROCESS_PARSER_CONFIG.maxParseLines;
export const PARSER_WORKER_ENABLED = PROCESS_PARSER_CONFIG.workerEnabled;
export const PARSER_WORKER_POOL_POLICY = PROCESS_PARSER_CONFIG.workerPoolPolicy;
export const PARSER_WORKER_POOL_SIZE = PARSER_WORKER_POOL_POLICY.size;
export const PARSER_WORKER_QUEUE_POLICY = PROCESS_PARSER_CONFIG.workerQueuePolicy;
export const PARSER_WORKER_QUEUE_MAX = PARSER_WORKER_QUEUE_POLICY.max;
export const PARSER_WORKER_REQUEST_TIMEOUT_MS = PROCESS_PARSER_CONFIG.workerRequestTimeoutMs;
export const PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES = PROCESS_PARSER_CONFIG.mainThreadFallbackMaxBytes;
export const PARSER_WORKER_RESTART_BACKOFF_MS = Object.freeze([100, 250, 500, 1_000, 2_000, 5_000]);
