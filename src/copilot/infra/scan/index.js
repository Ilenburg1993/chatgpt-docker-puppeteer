// @ts-check
/**
 * Barrel interno do domínio de scan.
 *
 * @module copilot/infra/scan
 */

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
} from './glob.js';
