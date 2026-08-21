// @ts-check
/** @module copilot/infra/indexing/search */

export { normalizeSearchWindow, paginateSearchItems, paginateSearchText } from './shared/index.js';
export { execSearchFile, isRipgrepAvailable, streamSearchFile } from './subprocess/index.js';
export {
    buildSymbolPattern,
    escapeRegex,
    formatIndexSymbolRows,
    kindToGlobs,
    searchWorkspaceSymbols,
} from './symbol/index.js';
export {
    buildGrepArgs,
    canUseIndexSearch,
    filterIndexRowsByGlob,
    formatIndexImportRows,
    formatIndexSearchRows,
    formatLiteralIndexSearchRows,
    searchText,
} from './text/index.js';
