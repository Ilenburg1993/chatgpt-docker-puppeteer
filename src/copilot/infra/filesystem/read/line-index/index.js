// @ts-check
/** @module copilot/infra/filesystem/read/line-index */

/** @typedef {import('./types.js').ByteLineIndexEntry} ByteLineIndexEntry */
/** @typedef {import('./types.js').ByteLineIndexLookup} ByteLineIndexLookup */

export { resolveByteLineSeedStreamHighWaterMark } from './policy.js';
export { appendPhysicalLineStartsFromBuffer, scanPhysicalLineStartsFromBuffer } from './scanner.js';
export {
    discardStaleByteLineIndex,
    ensureByteLineIndexInvalidationHook,
    getByteLineIndex,
    getByteLineIndexStats,
    invalidateByteLineIndexPath,
    invalidateByteLineIndexSubtree,
    recordByteLineIndexCapturedRangeReuse,
    recordByteLineIndexRangeRead,
    rememberByteLineIndexStreamSeed,
} from './state.js';
