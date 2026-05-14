// @ts-check
/**
 * Cópia baixa de filesystem.
 *
 * @module copilot/infra/io/fs/copy
 */

import { copyFile } from 'node:fs/promises';

/**
 * @param {string} source
 * @param {string} destination
 */
export async function copyFileUnlocked(source, destination) {
    await copyFile(source, destination);
}
