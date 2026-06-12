// @ts-check
/**
 * JSON store baixo baseado em filesystem.
 *
 * @module copilot/infra/storage/json-store
 */

import { existsSync } from 'node:fs';
import { writeFileAtomicPortable } from '../io/fs/portable-atomic.js';
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
 * @returns {boolean}
 */
export function fileExists(filePath) {
    return existsSync(filePath);
}
