// @ts-check
/** Operational parser health projection. */

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import {
    MAX_PARSE_DURATION_MS,
    MAX_PARSE_LINE_GUARD,
    PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES,
    PARSER_WORKER_ENABLED,
    PARSER_WORKER_POOL_POLICY,
    PARSER_WORKER_POOL_SIZE,
    PARSER_WORKER_QUEUE_MAX,
    PARSER_WORKER_QUEUE_POLICY,
    PARSER_WORKER_REQUEST_TIMEOUT_MS,
    getParserRuntimeStatsSnapshot,
} from '../foundation/index.js';
/** @param {ReturnType<typeof import('../cache/runtime/index.js').createParserCacheRuntime>} parserCacheRuntime */
export function getParserCacheStats(parserCacheRuntime) {
    if (!parserCacheRuntime) throw new TypeError('getParserCacheStats requires an explicit ParserCacheRuntime.');
    const worker = parserCacheRuntime.workerRuntime?.status() ?? {
        queueLength: 0,
        poolInitialized: false,
        poolDisabledByError: false,
        poolShuttingDown: false,
        poolRestarting: 0,
        consecutiveInitFailures: 0,
        nextInitAttemptAtMs: null,
    };
    const cache = parserCacheRuntime.snapshot();
    return {
        parserPolicyVersion: BABEL_PARSER_POLICY_VERSION,
        parserProfile: 'symbols',
        fileContext: {
            ...cache.fileContext,
        },
        maxParseDurationMs: MAX_PARSE_DURATION_MS,
        maxParseLines: MAX_PARSE_LINE_GUARD,
        workerEnabled: PARSER_WORKER_ENABLED,
        workerPoolSize: PARSER_WORKER_POOL_SIZE,
        workerPoolSizeSource: PARSER_WORKER_POOL_POLICY.source,
        availableParallelism: PARSER_WORKER_POOL_POLICY.availableParallelism,
        workerQueueMax: PARSER_WORKER_QUEUE_MAX,
        workerQueueMaxSource: PARSER_WORKER_QUEUE_POLICY.source,
        workerQueueLength: worker.queueLength,
        workerRequestTimeoutMs: PARSER_WORKER_REQUEST_TIMEOUT_MS,
        workerPoolInitialized: worker.poolInitialized,
        workerPoolDisabledByError: worker.poolDisabledByError,
        workerPoolShuttingDown: worker.poolShuttingDown,
        workerPoolRestarting: worker.poolRestarting,
        workerPoolConsecutiveInitFailures: worker.consecutiveInitFailures,
        workerPoolNextInitAttemptAtMs: worker.nextInitAttemptAtMs,
        ...cache.symbol,
        ...getParserRuntimeStatsSnapshot(),
        mainThreadFallbackMaxBytes: PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES,
    };
}
