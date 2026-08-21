// @ts-check
/** @module copilot/infra/indexing/parser/cache */

export {
    ensureParserInvalidationHook,
    fileContextCache,
    fileContextCacheStats,
    invalidateParserCache,
    isFileContextCacheEnabled,
    symbolCache,
} from './state.js';
export { parseAndCacheSymbols } from './symbols.js';
