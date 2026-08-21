// @ts-check
/** @module copilot/infra/public/platform/node/filesystem */

/** @typedef {import('../../../../platform/node/filesystem/index.js').IoDurabilityMode} IoDurabilityMode */

export {
    assertSuccessfulSync,
    normalizeIoDurability,
    shouldFlushFile,
    shouldSyncDirectory,
    syncFileBestEffort,
    syncFileHandleBestEffort,
    syncParentDirectoryBestEffort,
} from '../../../../platform/node/filesystem/index.js';
