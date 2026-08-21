// @ts-check
/** @module copilot/infra/filesystem/invalidation/cross-process */

/** @typedef {import('./types.js').CrossProcessInvalidationEvent} CrossProcessInvalidationEvent */
/** @typedef {import('./types.js').CrossProcessInvalidationConfig} CrossProcessInvalidationConfig */
/** @typedef {import('./types.js').CrossProcessInvalidationRow} CrossProcessInvalidationRow */

export { readCrossProcessInvalidationConfig } from './config.js';
export { readCrossProcessInvalidationReplay } from './replay.js';
export {
    getCrossProcessInvalidationStats,
    publishCrossProcessInvalidation,
    startCrossProcessInvalidationConsumer,
    stopCrossProcessInvalidationConsumer,
} from './runtime.js';
export { createCrossProcessInvalidationJournal } from './store.js';
