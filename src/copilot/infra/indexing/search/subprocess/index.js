// @ts-check
/** @module copilot/infra/indexing/search/subprocess */

/** @typedef {import('./types.js').SearchSubprocessOptions} SearchSubprocessOptions */
/** @typedef {import('./types.js').SearchStreamingSubprocessOptions} SearchStreamingSubprocessOptions */

export { execSearchFile } from './exec.js';
export { isRipgrepAvailable } from './ripgrep.js';
export { streamSearchFile } from './stream.js';
