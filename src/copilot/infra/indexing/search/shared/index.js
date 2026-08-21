// @ts-check
/** @module copilot/infra/indexing/search/shared */

export { normalizeSearchWindow, paginateSearchItems, paginateSearchText } from '../projection/index.js';
export {
    countSearchMatchLines,
    countSearchOutputLines,
    createStreamingSearchCollector,
    sanitizeSearchOutput,
} from './output.js';
export { assertValidTargetPath, getIoSearchBudget } from './policy.js';
