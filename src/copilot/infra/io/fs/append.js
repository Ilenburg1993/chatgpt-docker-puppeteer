// @ts-check
/**
 * append baixo de filesystem.
 *
 * @module copilot/infra/io/fs/append
 */

import { appendFile } from 'node:fs/promises';

/**
 * @param {string} filePath
 * @param {string | Buffer} payload
 * @param {{ mode?: number }} [options]
 */
export async function appendFileUnlocked(filePath, payload, options = {}) {
    await appendFile(filePath, payload, options.mode === undefined ? undefined : { mode: options.mode });
}
