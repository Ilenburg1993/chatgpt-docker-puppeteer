// @ts-check
/** @module copilot/infra/filesystem/read */

/** @typedef {import('./snapshot/index.js').TextFileSnapshot} TextFileSnapshot */

export { readBytes, readLines, readText } from './cache/index.js';
export { readTextChunks, readTextChunksStream, readTextLineChunks, readTextLineChunksStream } from './chunks/index.js';
export {
    listDirectoryNamesFresh,
    lstatPath,
    readBytesFresh,
    readBytesRangeFresh,
    readTextFresh,
    statPath,
} from './fresh/index.js';
export {
    createStaleSnapshotError,
    lstatPathSnapshot,
    readBytesFileRangeSnapshot,
    readBytesFileSnapshot,
    readTextFileSnapshot,
    readTextLinesSnapshot,
    sameFileSnapshot,
    statPathSnapshot,
} from './snapshot/index.js';
