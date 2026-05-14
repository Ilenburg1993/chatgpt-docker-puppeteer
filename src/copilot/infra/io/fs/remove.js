// @ts-check
/**
 * Remoção baixa de filesystem.
 *
 * @module copilot/infra/io/fs/remove
 */

import { rm, unlink } from 'node:fs/promises';

/** @param {string} filePath */
export async function deleteFileUnlocked(filePath) {
    await unlink(filePath);
}

/**
 * @param {string} filePath
 * @param {{ recursive?: boolean; force?: boolean }} [options]
 */
export async function removePathUnlocked(filePath, options = {}) {
    await rm(filePath, { recursive: Boolean(options.recursive), force: Boolean(options.force) });
}
