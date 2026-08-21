// @ts-check
/** Thin query/invalidation facade over the lazy index runtime. */

import { getIoIndex } from './runtime/index.js';

/**
 * @param {string} query
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['search']>[1]} [options]
 */
export function searchIoIndex(query, options = {}) {
    return getIoIndex()?.search(query, options) ?? [];
}

/**
 * Search exact literal substrings in raw indexed chunks without spawning an external grep process.
 *
 * @param {string} query
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['searchLiteral']>[1]} [options]
 */
export function searchIoIndexLiteral(query, options = {}) {
    return getIoIndex()?.searchLiteral(query, options) ?? [];
}

/**
 * @param {string} name
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['findSymbol']>[1]} [options]
 */
export function findIoIndexSymbol(name, options = {}) {
    return getIoIndex()?.findSymbol(name, options) ?? [];
}

/**
 * @param {string} source
 * @param {{ maxResults?: number; exactSource?: boolean }} [options]
 */
export function findIoIndexImports(source, options = {}) {
    return getIoIndex()?.findImports(source, options) ?? [];
}

/**
 * @param {string} pathPrefix
 * @returns {ReturnType<NonNullable<ReturnType<typeof getIoIndex>>['findImportsByPath']>}
 */
export function findIoIndexImportsByPath(pathPrefix) {
    return getIoIndex()?.findImportsByPath(pathPrefix) ?? [];
}

/** @param {string} filePath */
export function invalidateIoIndexPath(filePath) {
    return getIoIndex()?.invalidatePath(filePath) ?? false;
}
