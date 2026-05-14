// @ts-check
/**
 * Barrel interno do domínio de scan.
 *
 * @module copilot/infra/scan
 */

export { mapInBatches, normalizeBatchSize } from './batching.js';
export { buildFileFingerprint, classifyStats } from './fingerprint.js';
export { loadGitignoreMatcher } from './gitignore.js';
export { matchesAnyPattern, matchesFilter, simpleGlobToRegExp } from './glob.js';
