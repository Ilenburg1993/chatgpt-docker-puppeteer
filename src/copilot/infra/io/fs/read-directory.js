// @ts-check
/**
 * Directory reads low-level, deliberately cache-free. Higher layers add observability and intent-specific policy.
 *
 * @module copilot/infra/io/fs/read-directory
 */

import { readdir } from 'node:fs/promises';

/**
 * Read one physical directory snapshot as names only. Missing directories remain ENOENT so callers can distinguish an
 * optional absent namespace from an empty directory without a pre-access syscall.
 *
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
export async function readDirectoryNamesSnapshot(dirPath) {
    return readdir(dirPath, { encoding: 'utf8', withFileTypes: false });
}
