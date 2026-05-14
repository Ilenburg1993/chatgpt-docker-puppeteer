// @ts-check
/**
 * mkdir baixo de filesystem.
 *
 * @module copilot/infra/io/fs/mkdir
 */

import { mkdir } from 'node:fs/promises';

/**
 * @param {string} dirPath
 * @param {{ recursive?: boolean; mode?: number }} [options]
 */
export async function mkdirPathUnlocked(dirPath, options = {}) {
    await mkdir(
        dirPath,
        options.mode === undefined
            ? { recursive: Boolean(options.recursive) }
            : { recursive: Boolean(options.recursive), mode: options.mode },
    );
}
