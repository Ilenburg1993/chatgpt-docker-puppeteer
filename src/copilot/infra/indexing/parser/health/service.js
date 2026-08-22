// @ts-check
/** Operational parser health projection from the same owner-bound policy used by parser execution. */

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { getParserRuntimeStatsSnapshot } from '../foundation/index.js';

/** @param {ReturnType<typeof import('../cache/runtime/index.js').createParserCacheRuntime>} parserCacheRuntime */
export function getParserCacheStats(parserCacheRuntime) {
    if (!parserCacheRuntime) throw new TypeError('getParserCacheStats requires an explicit ParserCacheRuntime.');
    const parserConfig = parserCacheRuntime.parserConfig;
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
        maxParseBytes: parserConfig.maxParseBytes,
        maxParseDurationMs: parserConfig.maxParseDurationMs,
        maxParseLines: parserConfig.maxParseLines,
        workerEnabled: parserConfig.workerEnabled,
        workerPoolSize: parserConfig.workerPoolPolicy.size,
        workerPoolSizeSource: parserConfig.workerPoolPolicy.source,
        availableParallelism: parserConfig.workerPoolPolicy.availableParallelism,
        workerQueueMax: parserConfig.workerQueuePolicy.max,
        workerQueueMaxSource: parserConfig.workerQueuePolicy.source,
        workerQueueLength: worker.queueLength,
        workerRequestTimeoutMs: parserConfig.workerRequestTimeoutMs,
        workerPoolInitialized: worker.poolInitialized,
        workerPoolDisabledByError: worker.poolDisabledByError,
        workerPoolShuttingDown: worker.poolShuttingDown,
        workerPoolRestarting: worker.poolRestarting,
        workerPoolConsecutiveInitFailures: worker.consecutiveInitFailures,
        workerPoolNextInitAttemptAtMs: worker.nextInitAttemptAtMs,
        ...cache.symbol,
        ...getParserRuntimeStatsSnapshot(),
        mainThreadFallbackMaxBytes: parserConfig.mainThreadFallbackMaxBytes,
    };
}
