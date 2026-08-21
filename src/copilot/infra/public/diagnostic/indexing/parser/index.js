// @ts-check
/** @module copilot/infra/public/diagnostic/indexing/parser */

export {
    buildOutline,
    extractJsonSchema,
    extractMarkdownOutline,
    extractTopComments,
    getParserCacheStats,
    parseAndCacheSymbols,
    parseFileForContext,
    parseFileSymbols,
    resolveParserWorkerPoolPolicy,
    resolveParserWorkerQueuePolicy,
    windowFileContext,
} from '../../../../indexing/parser/index.js';
