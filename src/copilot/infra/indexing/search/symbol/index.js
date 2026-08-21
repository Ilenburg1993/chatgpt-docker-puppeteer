// @ts-check
/** @module copilot/infra/indexing/search/symbol */

export { buildSymbolPattern, escapeRegex, formatIndexSymbolRows, kindToGlobs } from '../projection/index.js';
export { searchWorkspaceSymbols } from './service.js';
