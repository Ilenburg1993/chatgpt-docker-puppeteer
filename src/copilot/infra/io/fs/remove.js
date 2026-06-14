// @ts-check
/**
 * Remoção baixa de filesystem.
 *
 * @module copilot/infra/io/fs/remove
 */

import { rm, unlink } from 'node:fs/promises';

/**
 * @param {string} filePath
 * @param {{ recursive?: boolean; recursiveConfirmation?: string }} options
 */
export function assertRecursiveRemovalConfirmed(filePath, options) {
    if (!options.recursive) return;
    if (options.recursiveConfirmation === filePath) return;
    const error = /** @type {Error & { code?: string }} */ (
        new Error('Recursive removal requires recursiveConfirmation to exactly match the resolved target path.')
    );
    error.code = 'ERECURSIVEREMOVECONFIRMATION';
    throw error;
}

/** @param {string} filePath */
export async function deleteFileUnlocked(filePath) {
    await unlink(filePath);
}

/**
 * @param {string} filePath
 * @param {{ recursive?: boolean; force?: boolean; recursiveConfirmation?: string }} [options]
 */
export async function removePathUnlocked(filePath, options = {}) {
    assertRecursiveRemovalConfirmed(filePath, options);
    await rm(filePath, { recursive: Boolean(options.recursive), force: Boolean(options.force) });
}
