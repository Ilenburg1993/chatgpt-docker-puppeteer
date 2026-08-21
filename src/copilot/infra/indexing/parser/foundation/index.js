// @ts-check
/** @module copilot/infra/indexing/parser/foundation */

/** @typedef {import('./types.js').FileSymbols} FileSymbols */
/** @typedef {import('./types.js').FileContext} FileContext */
/** @typedef {import('./types.js').ParserFingerprint} ParserFingerprint */
/** @typedef {import('./types.js').SymbolCacheEntry} SymbolCacheEntry */

export {
    FILE_CONTEXT_CACHE_DISABLED_VALUES,
    FILE_CONTEXT_CACHE_MAX_BYTES,
    FILE_CONTEXT_CACHE_MAX_ENTRIES,
    FILE_CONTEXT_CACHE_TTL_MS,
    MAX_PARSE_BYTES,
    MAX_PARSE_DURATION_MS,
    MAX_PARSE_LINE_GUARD,
    PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES,
    PARSER_WORKER_ENABLED,
    PARSER_WORKER_POOL_POLICY,
    PARSER_WORKER_POOL_SIZE,
    PARSER_WORKER_QUEUE_MAX,
    PARSER_WORKER_QUEUE_POLICY,
    PARSER_WORKER_REQUEST_TIMEOUT_MS,
    PARSER_WORKER_RESTART_BACKOFF_MS,
    SYMBOL_CACHE_MAX_BYTES,
    SYMBOL_CACHE_MAX_ENTRIES,
    resolveParserWorkerPoolPolicy,
    resolveParserWorkerQueuePolicy,
} from './config.js';
export { classifyParserExtension, normalizeParserPath } from './path.js';
export { parserRuntimeStats } from './runtime-state.js';
