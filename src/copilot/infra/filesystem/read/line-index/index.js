// @ts-check
/** @module copilot/infra/filesystem/read/line-index */

/** @typedef {import('./types.js').ByteLineIndexEntry} ByteLineIndexEntry */
/** @typedef {import('./types.js').ByteLineIndexLookup} ByteLineIndexLookup */

export { readByteLineIndexConfig, resolveByteLineSeedStreamHighWaterMark } from './policy.js';
export { createByteLineIndexRuntime } from './runtime.js';
export { appendPhysicalLineStartsFromBuffer, scanPhysicalLineStartsFromBuffer } from './scanner.js';
