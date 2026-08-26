// @ts-check
/** Public membrane for repository source-integrity barriers. */

export {
    captureRepositorySourceBarrier,
    classifyRepositorySourceDriftProvenance,
    fingerprintRepositorySourceBarrierEntries,
    parseRepositorySourceBarrierJson,
    readRepositorySourceBarrierManifest,
    REPOSITORY_SOURCE_BARRIER_LIMITS,
    verifyRepositorySourceBarrier,
    verifyRepositorySourceBarrierManifest,
} from '../runtime.js';

/** @typedef {import('../runtime.js').RepositorySourceBarrier} RepositorySourceBarrier */
/** @typedef {import('../runtime.js').RepositorySourceBarrierEntry} RepositorySourceBarrierEntry */
/** @typedef {import('../runtime.js').RepositorySourceDrift} RepositorySourceDrift */
