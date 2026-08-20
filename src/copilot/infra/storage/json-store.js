// @ts-check
/**
 * JSON store baixo baseado em filesystem.
 *
 * @module copilot/infra/storage/json-store
 */

import { writeFileAtomicPortable } from '../io/fs/portable-atomic.js';
import { statPath } from '../io/fs/read-services.js';
import { readTextFileSnapshot } from '../io/fs/read-text.js';

/**
 * @template T
 * @param {string} filePath
 * @param {T} defaultValue
 * @returns {Promise<T>}
 */
export async function readJson(filePath, defaultValue) {
    try {
        const raw = await readTextFileSnapshot(filePath);
        return JSON.parse(raw.content);
    } catch {
        return defaultValue;
    }
}

/**
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
export async function writeJson(filePath, data) {
    await writeFileAtomicPortable(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
    try {
        const { stats } = await statPath(filePath, { advisoryLimits: { caller: 'infra.storage.json-store' } });
        return stats.isFile() || stats.isDirectory();
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw error;
    }
}
