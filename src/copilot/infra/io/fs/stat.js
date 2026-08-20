// @ts-check
/**
 * Stat baixo de filesystem.
 *
 * @module copilot/infra/io/fs/stat
 */

import { lstat, stat } from 'node:fs/promises';

/** @param {string} filePath */
export async function statPathSnapshot(filePath) {
    return stat(filePath);
}

/** @param {string} filePath */
export async function lstatPathSnapshot(filePath) {
    return lstat(filePath);
}
