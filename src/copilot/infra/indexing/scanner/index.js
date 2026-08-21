// @ts-check
/** @module copilot/infra/indexing/scanner */

/** @typedef {import('./service.js').IoScanEntry} IoScanEntry */

export { mapInBatches, normalizeBatchSize } from './batching.js';
export { buildFileFingerprint, classifyStats } from './fingerprint.js';
export { loadGitignoreMatcher } from './gitignore.js';
export {
    IO_GLOB_ENGINE,
    matchesAnyPattern,
    matchesFilter,
    matchesGlobPattern,
    matchesPlainPathPattern,
    simpleGlobToRegExp,
} from './glob-match/index.js';
export { getIoScanBasename, scanDirectory } from './service.js';
