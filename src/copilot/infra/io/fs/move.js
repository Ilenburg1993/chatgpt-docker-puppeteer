// @ts-check
/**
 * Move baixo de filesystem com fallback cross-device.
 *
 * @module copilot/infra/io/fs/move
 */

import { copyFile, rename, unlink } from 'node:fs/promises';

/**
 * @param {string} source
 * @param {string} destination
 */
export async function moveFileUnlocked(source, destination) {
    try {
        await rename(source, destination);
    } catch (error) {
        const errCode = /** @type {{ code?: unknown }} */ (error)?.code;
        if (errCode !== 'EXDEV') throw error;
        await copyFile(source, destination);
        await unlink(source);
    }
}
