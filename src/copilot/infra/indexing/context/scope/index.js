// @ts-check
/** @module copilot/infra/indexing/context/scope */

/** @typedef {import('./types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./types.js').ScopeStats} ScopeStats */

export { declareScope } from './lifecycle.js';
export { findSymbol, getScopeContext, getScopeStats, getScopeSymbolIndex, listScopes } from './query.js';
export { closeScope, invalidateScopePath, refreshScope } from './refresh.js';
