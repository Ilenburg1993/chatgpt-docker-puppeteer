// @ts-check
/**
 * Registry do índice L2 de I/O.
 *
 * O índice é lazy e local ao processo. Ele usa `copilot.sqlite`, mas permanece separado do cache blob L2: cache acelera
 * payloads; índice responde perguntas de descoberta, busca e navegação simbólica.
 *
 * @module copilot/infra/io-index-registry
 */

import { getCopilotDb } from '#copilot/db';
import { registerInvalidationHook } from './io-cache.js';
import { createIoIndexSqlite } from './io-index-sqlite.js';

/** @type {ReturnType<typeof createIoIndexSqlite> | null} */
let _ioIndex = null;

registerInvalidationHook((filePath) => {
    try {
        getIoIndex()?.invalidatePath(filePath);
    } catch {
        /* invalidation hooks não devem derrubar o writer */
    }
});

function isDisabled() {
    return String(process.env['IO_INDEX_ENABLED'] ?? '1').trim() === '0';
}

export function getIoIndex() {
    if (isDisabled()) return null;
    if (_ioIndex) return _ioIndex;
    try {
        _ioIndex = createIoIndexSqlite({ db: getCopilotDb() });
        return _ioIndex;
    } catch {
        return null;
    }
}

export function getIoIndexStats() {
    const index = getIoIndex();
    if (!index) {
        return {
            enabled: false,
            available: false,
            reason: isDisabled() ? 'disabled-via-env' : 'unavailable',
        };
    }
    return index.getStats();
}

/**
 * @param {string} directory
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['indexDirectory']>[1]} [options]
 */
export async function buildIoIndexForDirectory(directory, options = {}) {
    const index = getIoIndex();
    if (!index) {
        return {
            available: false,
            indexed: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
            reason: 'index-unavailable',
        };
    }
    return index.indexDirectory(directory, options);
}

/**
 * @param {string} query
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['search']>[1]} [options]
 */
export function searchIoIndex(query, options = {}) {
    return getIoIndex()?.search(query, options) ?? [];
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
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['findImports']>[1]} [options]
 */
export function findIoIndexImports(source, options = {}) {
    return getIoIndex()?.findImports(source, options) ?? [];
}

/**
 * @param {string} filePath
 */
export function invalidateIoIndexPath(filePath) {
    return getIoIndex()?.invalidatePath(filePath) ?? false;
}

export function resetIoIndexForTest() {
    _ioIndex = null;
}
