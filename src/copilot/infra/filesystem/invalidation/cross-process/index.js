// @ts-check
/** @module copilot/infra/filesystem/invalidation/cross-process */
/** @typedef {import('./types.js').CrossProcessInvalidationEvent} CrossProcessInvalidationEvent */
/** @typedef {import('./types.js').CrossProcessInvalidationConfig} CrossProcessInvalidationConfig */
/** @typedef {import('./types.js').CrossProcessInvalidationRow} CrossProcessInvalidationRow */
export { readCrossProcessInvalidationConfig } from './config.js';
export { createCrossProcessInvalidationRuntime } from './journal-runtime.js';
export {
    CROSS_PROCESS_INVALIDATION_TABLE,
    createCrossProcessInvalidationJournal,
    ensureJournalSchema,
} from './store.js';
export { normalizeNonNegativeInteger, readSequence, readSequenceValue } from './utils.js';
