// @ts-check
/** Operational parser health projection. */

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { fileContextCache, fileContextCacheStats, isFileContextCacheEnabled, symbolCache } from '../cache/index.js';
import {
    FILE_CONTEXT_CACHE_MAX_BYTES,
    FILE_CONTEXT_CACHE_MAX_ENTRIES,
    MAX_PARSE_DURATION_MS,
    MAX_PARSE_LINE_GUARD,
    PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES,
    PARSER_WORKER_ENABLED,
    PARSER_WORKER_POOL_POLICY,
    PARSER_WORKER_POOL_SIZE,
    PARSER_WORKER_QUEUE_MAX,
    PARSER_WORKER_QUEUE_POLICY,
    PARSER_WORKER_REQUEST_TIMEOUT_MS,
    parserRuntimeStats,
    SYMBOL_CACHE_MAX_BYTES,
    SYMBOL_CACHE_MAX_ENTRIES,
} from '../foundation/index.js';
import { getParserWorkerRuntimeStatus } from '../worker/index.js';

export function getParserCacheStats() {
    const worker = getParserWorkerRuntimeStatus();
    return {
        parserPolicyVersion: BABEL_PARSER_POLICY_VERSION,
        parserProfile: 'symbols',
        size: symbolCache.size,
        maxSize: SYMBOL_CACHE_MAX_ENTRIES,
        calculatedSize: symbolCache.calculatedSize,
        maxBytes: SYMBOL_CACHE_MAX_BYTES,
        fileContext: {
            enabled: isFileContextCacheEnabled(),
            size: fileContextCache.size,
            maxSize: FILE_CONTEXT_CACHE_MAX_ENTRIES,
            calculatedSize: fileContextCache.calculatedSize,
            maxBytes: FILE_CONTEXT_CACHE_MAX_BYTES,
            ...fileContextCacheStats,
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
        ...parserRuntimeStats,
        mainThreadFallbackMaxBytes: PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES,
    };
}
