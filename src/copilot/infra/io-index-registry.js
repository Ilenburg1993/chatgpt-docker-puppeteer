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
import { resolve } from 'node:path';
import { beginIoAdvisoryBudget } from './io-advisory-budget.js';
import { registerInvalidationHook } from './io-cache.js';
import { createIoIndexSqlite } from './io-index-sqlite.js';

/** @type {ReturnType<typeof createIoIndexSqlite> | null} */
let _ioIndex = null;

/** @type {Map<string, Promise<unknown>>} */
const _inflightIndexBuilds = new Map();

/** @type {(() => void) | null} */
let _indexInvalidationUnregister = null;

function ensureIndexInvalidationHook() {
    if (_indexInvalidationUnregister) return;
    _indexInvalidationUnregister =
        registerInvalidationHook((filePath) => {
            try {
                getIoIndex()?.invalidatePath(filePath);
            } catch {
                /* invalidation hooks não devem derrubar o writer */
            }
        }) ?? null;
}

function isDisabled() {
    return String(process.env['IO_INDEX_ENABLED'] ?? '1').trim() === '0';
}

export function getIoIndex() {
    ensureIndexInvalidationHook();
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

    const normalizedDirectory = resolve(directory);
    const key = JSON.stringify([
        normalizedDirectory,
        options.workspaceRoot ? resolve(options.workspaceRoot) : null,
        options.recursive ?? null,
        options.depth ?? null,
        options.respectGitignore ?? null,
        options.concurrency ?? null,
        options.maxFiles ?? null,
        options.pruneMissing ?? null,
        options.extensions ? [...options.extensions].map((ext) => String(ext).toLowerCase()).sort() : null,
        options.include ? [...options.include].map(String).sort() : null,
        options.exclude ? [...options.exclude].map(String).sort() : null,
    ]);

    const mayCoalesce = options.signal === undefined;
    const inflight = mayCoalesce ? _inflightIndexBuilds.get(key) : null;
    if (inflight) {
        return /** @type {Awaited<ReturnType<typeof index.indexDirectory>>} */ (await inflight);
    }

    const budget = beginIoAdvisoryBudget({
        operation: 'index.build',
    });
    const buildPromise = (async () => {
        try {
            return await index.indexDirectory(directory, options);
        } finally {
            budget.finish();
            if (mayCoalesce) _inflightIndexBuilds.delete(key);
        }
    })();

    if (mayCoalesce) _inflightIndexBuilds.set(key, buildPromise);
    return await buildPromise;
}

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

/**
 * @param {string} filePath
 */
export function invalidateIoIndexPath(filePath) {
    return getIoIndex()?.invalidatePath(filePath) ?? false;
}

export function resetIoIndexForTest() {
    _ioIndex = null;
    _inflightIndexBuilds.clear();
    _indexInvalidationUnregister?.();
    _indexInvalidationUnregister = null;
}
