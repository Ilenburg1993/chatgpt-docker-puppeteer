// @ts-check
/** @module copilot/infra/indexing/search/symbol */

export { buildSymbolPattern, escapeRegex, formatIndexSymbolRows, kindToGlobs } from './pattern.js';
export { searchWorkspaceSymbols } from './service.js';
