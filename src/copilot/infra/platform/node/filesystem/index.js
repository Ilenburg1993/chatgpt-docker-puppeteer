// @ts-check
/**
 * Node filesystem primitives that are lower-level than infra capabilities.
 *
 * @module copilot/infra/platform/node/filesystem
 */

/** @typedef {import('./durability.js').IoDurabilityMode} IoDurabilityMode */

export {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldFlushFile,
    shouldSyncDirectory,
    syncFileBestEffort,
    syncFileHandleBestEffort,
    syncParentDirectoryBestEffort,
} from './durability.js';
