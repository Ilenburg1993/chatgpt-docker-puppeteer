// @ts-check
/** @module copilot/infra/public/diagnostic/indexing/scanner */

export {
    IO_GLOB_ENGINE,
    buildFileFingerprint,
    classifyStats,
    getIoScanBasename,
    loadGitignoreMatcher,
    mapInBatches,
    matchesAnyPattern,
    matchesFilter,
    matchesGlobPattern,
    matchesPlainPathPattern,
    normalizeBatchSize,
    scanDirectory,
    simpleGlobToRegExp,
} from '../../../../indexing/scanner/index.js';
