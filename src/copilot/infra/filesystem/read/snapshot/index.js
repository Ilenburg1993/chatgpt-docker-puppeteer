// @ts-check
/** @module copilot/infra/filesystem/read/snapshot */

/** @typedef {import('./text.js').TextFileSnapshot} TextFileSnapshot */

export {
    createStaleSnapshotError,
    readBytesFileRangeSnapshot,
    readBytesFileSnapshot,
    sameFileSnapshot,
} from './bytes.js';
export {
    buildSnapshotVersion,
    chunkSnapshotMatchesStats,
    createStaleChunkSnapshotError,
    fingerprintFromStats,
    isStaleChunkSnapshotError,
} from './consistency.js';
export { readDirectoryNamesSnapshot } from './directory.js';
export { readTextLinesSnapshot } from './lines.js';
export { lstatPathSnapshot, statPathSnapshot } from './stat.js';
export { readTextFileSnapshot } from './text.js';
