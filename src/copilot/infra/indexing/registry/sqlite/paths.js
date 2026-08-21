// @ts-check
/**
 * Normalização de paths e filtros do index-store SQLite.
 *
 * @module copilot/infra/indexing/registry/sqlite/paths
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
 * Constrói limites lexicográficos para selecionar um path exato e seus descendentes usando índice B-tree.
 *
 * @param {string} normalizedPath
 * @returns {{ exact: string; descendantStart: string; descendantEnd: string }}
 */
export function buildIndexPathTreeRange(normalizedPath) {
    const exact = normalizeIndexPath(normalizedPath);
    const descendantStart = exact.endsWith('/') ? exact : `${exact}/`;
    const lastIndex = descendantStart.length - 1;
    const nextCodePoint = descendantStart.codePointAt(lastIndex);
    if (nextCodePoint === undefined) {
        throw new TypeError('normalizedPath must not be empty');
    }
    return {
        exact,
        descendantStart,
        descendantEnd: `${descendantStart.slice(0, lastIndex)}${String.fromCodePoint(nextCodePoint + 1)}`,
    };
}

/**
 * @param {import('#copilot/infra/internal/indexing/scanner').IoScanEntry[]} entries
 * @returns {import('#copilot/infra/internal/indexing/scanner').IoScanEntry[]}
 */
export function flattenScanEntries(entries) {
    /** @type {import('#copilot/infra/internal/indexing/scanner').IoScanEntry[]} */
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
