// @ts-check
/**
 * Stat baixo de filesystem.
 *
 * @module copilot/infra/io/fs/stat
 */

import { stat } from 'node:fs/promises';

/** @param {string} filePath */
export async function statPathSnapshot(filePath) {
    return stat(filePath);
}
