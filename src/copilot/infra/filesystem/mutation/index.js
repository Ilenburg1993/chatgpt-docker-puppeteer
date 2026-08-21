// @ts-check
/** @module copilot/infra/filesystem/mutation */

export { deleteFileLocked, removePathLocked } from './delete.js';
export { patchTextBatchLocked, patchTextLocked } from './patch/index.js';
export { copyFileLocked, moveFileLocked } from './transfer/index.js';
