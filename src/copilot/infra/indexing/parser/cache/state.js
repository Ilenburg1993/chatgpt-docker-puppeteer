// @ts-check
/** Bounded parser caches and invalidation ownership. */

import { registerIoInvalidationHook } from '#copilot/infra/internal/filesystem/invalidation';
import { LRUCache } from 'lru-cache';
import * as nodePath from 'node:path';
import {
    FILE_CONTEXT_CACHE_DISABLED_VALUES,
    FILE_CONTEXT_CACHE_MAX_BYTES,
    FILE_CONTEXT_CACHE_MAX_ENTRIES,
    FILE_CONTEXT_CACHE_TTL_MS,
    normalizeParserPath,
    SYMBOL_CACHE_MAX_BYTES,
    SYMBOL_CACHE_MAX_ENTRIES,
} from '../foundation/index.js';

/** @typedef {import('../foundation/index.js').FileSymbols} FileSymbols */
/** @typedef {import('../foundation/index.js').FileContext} FileContext */
/** @typedef {import('../foundation/index.js').SymbolCacheEntry} SymbolCacheEntry */

/** @param {FileSymbols} value */
function estimateFileSymbolsSize(value) {
    let size = Math.max(1, value.parsedBytes);
    for (const symbol of value.symbols) size += 96 + symbol.name.length * 2 + (symbol.docComment?.length ?? 0) * 2;
    for (const entry of value.imports) {
        size += 96 + entry.source.length * 2;
        for (const specifier of entry.specifiers) size += 16 + specifier.length * 2;
    }
    for (const entry of value.exports) size += 16 + entry.length * 2;
    return size;
}

/** @param {SymbolCacheEntry} value */
function estimateFileSymbolsCacheSize(value) {
    return estimateFileSymbolsSize(value.symbols);
}
/** @param {FileContext} value */
function estimateFileContextCacheSize(value) {
    let size = estimateFileSymbolsSize(value.symbols);
    for (const line of value.outline) size += 16 + line.length * 2;
    for (const comment of value.topComments) size += 16 + comment.length * 2;
    return size;
}

export const symbolCache = new LRUCache({
    max: SYMBOL_CACHE_MAX_ENTRIES,
    maxSize: SYMBOL_CACHE_MAX_BYTES,
    sizeCalculation: estimateFileSymbolsCacheSize,
    ttl: 5 * 60_000,
    updateAgeOnGet: true,
});
export const fileContextCache = new LRUCache({
    max: FILE_CONTEXT_CACHE_MAX_ENTRIES,
    maxSize: FILE_CONTEXT_CACHE_MAX_BYTES,
    sizeCalculation: estimateFileContextCacheSize,
    ttl: FILE_CONTEXT_CACHE_TTL_MS,
    updateAgeOnGet: true,
});

export const fileContextCacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    clears: 0,
    bypasses: 0,
    rejected: 0,
    hashComputations: 0,
    hashReuses: 0,
};
/** @type {(() => void) | null} */
let invalidationUnregister = null;

/** @param {string} normalizedPath @param {boolean} recursive */
export function clearFileContextCacheForNormalizedPath(normalizedPath, recursive) {
    let removed = 0;
    const exactPrefix = `${normalizedPath}\u0000`;
    const recursivePrefix = `${normalizedPath}${nodePath.sep}`;
    for (const key of [...fileContextCache.keys()]) {
        const textKey = String(key);
        if (!textKey.startsWith(exactPrefix) && !(recursive && textKey.startsWith(recursivePrefix))) continue;
        fileContextCache.delete(key);
        removed += 1;
    }
    fileContextCacheStats.clears += removed;
    return removed;
}

export function ensureParserInvalidationHook() {
    if (invalidationUnregister) return;
    invalidationUnregister = registerIoInvalidationHook((filePath, event) => {
        const normalized = normalizeParserPath(filePath);
        symbolCache.delete(normalized);
        clearFileContextCacheForNormalizedPath(normalized, event?.recursive === true);
        if (event?.recursive === true) {
            const prefix = `${normalized}${nodePath.sep}`;
            for (const key of symbolCache.keys()) if (String(key).startsWith(prefix)) symbolCache.delete(key);
        }
    });
}

/** @param {string} filePath */
export function invalidateParserCache(filePath) {
    const normalized = normalizeParserPath(filePath);
    symbolCache.delete(normalized);
    clearFileContextCacheForNormalizedPath(normalized, false);
}

export function isFileContextCacheEnabled() {
    const value = String(process.env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] ?? '1')
        .trim()
        .toLowerCase();
    return !FILE_CONTEXT_CACHE_DISABLED_VALUES.has(value);
}

export function resetParserCachesForTest() {
    symbolCache.clear();
    fileContextCache.clear();
    for (const key of /** @type {(keyof typeof fileContextCacheStats)[]} */ (Object.keys(fileContextCacheStats)))
        fileContextCacheStats[key] = 0;
    invalidationUnregister?.();
    invalidationUnregister = null;
}
