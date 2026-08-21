// @ts-check
/** @module copilot/infra/indexing/parser */

/** @typedef {import('#copilot/types/io-analysis').SymbolEntry} SymbolEntry */
/** @typedef {import('#copilot/types/io-analysis').ImportEntry} ImportEntry */
/** @typedef {import('./foundation/index.js').FileSymbols} FileSymbols */
/** @typedef {import('./foundation/index.js').FileContext} FileContext */

export {
    buildOutline,
    extractJsonSchema,
    extractMarkdownOutline,
    extractTopComments,
} from '#copilot/infra/internal/code-analysis';
export { invalidateParserCache, parseAndCacheSymbols } from './cache/index.js';
export { parseFileForContext, windowFileContext } from './context/index.js';
export { resolveParserWorkerPoolPolicy, resolveParserWorkerQueuePolicy } from './foundation/index.js';
export { getParserCacheStats } from './health/index.js';
export { parseFileSymbols } from './parse/index.js';
export { shutdownParserWorkerPool } from './worker/index.js';
