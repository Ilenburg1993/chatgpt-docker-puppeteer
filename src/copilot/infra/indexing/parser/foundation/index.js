// @ts-check
/** @module copilot/infra/indexing/parser/foundation */

/** @typedef {import('./types.js').FileSymbols} FileSymbols */
/** @typedef {import('./types.js').FileContext} FileContext */
/** @typedef {import('./types.js').ParserFingerprint} ParserFingerprint */
/** @typedef {import('./types.js').SymbolCacheEntry} SymbolCacheEntry */

export {
    DEFAULT_PARSER_PROCESS_CONFIG,
    PARSER_WORKER_RESTART_BACKOFF_MS,
    readParserProcessConfig,
    resolveParserWorkerPoolPolicy,
    resolveParserWorkerQueuePolicy,
} from './config.js';
export { classifyParserExtension, normalizeParserPath } from './path.js';
export {
    getParserRuntimeStatsSnapshot,
    incrementParserRuntimeCounter,
    recordParserRuntimeDuration,
    recordParserWorkerQueueDepth,
    recordParserWorkerQueueWait,
} from './runtime-state.js';
