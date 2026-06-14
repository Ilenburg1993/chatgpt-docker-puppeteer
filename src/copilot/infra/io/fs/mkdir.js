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
 * @returns {Promise<{ path: string; created: boolean; createdPath: string | undefined }>}
 */
export async function mkdirPathUnlocked(dirPath, options = {}) {
    const createdPath = await mkdir(
        dirPath,
        options.mode === undefined
            ? { recursive: Boolean(options.recursive) }
            : { recursive: Boolean(options.recursive), mode: options.mode },
    );
    return { path: dirPath, created: createdPath !== undefined, createdPath };
}
