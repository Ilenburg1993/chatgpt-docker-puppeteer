// @ts-check
/**
 * Normalização de paths e filtros do index-store SQLite.
 *
 * @module copilot/infra/index-store/sqlite/paths
 */

import { extname, relative, resolve } from 'node:path';

/**
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeIndexPath(filePath) {
    return resolve(filePath).replace(/\\/g, '/');
}

/**
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeRelativePath(workspaceRoot, filePath) {
    return relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

/**
 * @param {import('../../io-scanner.js').IoScanEntry[]} entries
 * @returns {import('../../io-scanner.js').IoScanEntry[]}
 */
export function flattenScanEntries(entries) {
    /** @type {import('../../io-scanner.js').IoScanEntry[]} */
    const out = [];
    for (const entry of entries) {
        if (entry.type === 'file') out.push(entry);
        if (Array.isArray(entry.children)) out.push(...flattenScanEntries(entry.children));
    }
    return out;
}

/**
 * @param {string} filePath
 * @param {readonly string[]} extensions
 * @returns {boolean}
 */
export function shouldIndexFile(filePath, extensions) {
    if (extensions.length === 0) return true;
    return extensions.includes(extname(filePath).toLowerCase());
}

/**
 * @param {readonly string[]} extensions
 * @returns {string[]}
 */
export function normalizeIndexExtensions(extensions) {
    return extensions.map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
}
