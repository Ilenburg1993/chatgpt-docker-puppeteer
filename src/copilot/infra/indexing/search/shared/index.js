// @ts-check
/** @module copilot/infra/indexing/search/shared */

export {
    countSearchMatchLines,
    countSearchOutputLines,
    createStreamingSearchCollector,
    sanitizeSearchOutput,
} from './output.js';
export { normalizeSearchWindow, paginateSearchItems, paginateSearchText } from './pagination.js';
export { assertValidTargetPath, getIoSearchBudget } from './policy.js';
