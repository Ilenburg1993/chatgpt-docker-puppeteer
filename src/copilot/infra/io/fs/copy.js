// @ts-check
/**
 * Cópia baixa de filesystem.
 *
 * @module copilot/infra/io/fs/copy
 */

import * as nodeFs from 'node:fs';
import { copyFile } from 'node:fs/promises';

/**
 * @param {string} source
 * @param {string} destination
 * @param {{ exclusive?: boolean }} [options]
 */
export async function copyFileUnlocked(source, destination, options = {}) {
    if (options.exclusive) {
        await copyFile(source, destination, nodeFs.constants.COPYFILE_EXCL);
        return;
    }
    await copyFile(source, destination);
}
