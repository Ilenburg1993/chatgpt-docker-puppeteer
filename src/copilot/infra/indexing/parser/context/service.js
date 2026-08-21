// @ts-check
/** File-context projection, bounded windowing and content-addressed context cache. */

import { buildOutline, extractTopComments } from '#copilot/infra/internal/code-analysis';
import { sha256, utf8ByteLength } from '#copilot/infra/internal/platform';
import {
    ensureParserInvalidationHook,
    fileContextCache,
    fileContextCacheStats,
    isFileContextCacheEnabled,
} from '../cache/index.js';
import { normalizeParserPath } from '../foundation/index.js';
import { parseFileSymbols } from '../parse/index.js';

/** @typedef {import('../foundation/index.js').FileContext} FileContext */

/** @param {string} filePath @param {string} content @param {string | undefined} suppliedContentHash */
function buildCacheKey(filePath, content, suppliedContentHash) {
    if (!isFileContextCacheEnabled()) return null;
    const normalized = normalizeParserPath(filePath);
    const normalizedSuppliedHash =
        typeof suppliedContentHash === 'string' && /^[0-9a-f]{64}$/iu.test(suppliedContentHash)
            ? suppliedContentHash.toLowerCase()
            : null;
    const hash = normalizedSuppliedHash ?? sha256(content);
    if (normalizedSuppliedHash) fileContextCacheStats.hashReuses += 1;
    else fileContextCacheStats.hashComputations += 1;
    return `${normalized}\u0000${content.length}\u0000${hash}`;
}

/** @param {string} filePath @param {string} content @param {{ contentHash?: string }} [options] @returns {Promise<FileContext>} */
export async function parseFileForContext(filePath, content, options = {}) {
    ensureParserInvalidationHook();
    const cacheKey = buildCacheKey(filePath, content, options.contentHash);
    if (cacheKey) {
        const cached = /** @type {FileContext | undefined} */ (fileContextCache.get(cacheKey));
        if (cached) {
            fileContextCacheStats.hits += 1;
            return cached;
        }
        fileContextCacheStats.misses += 1;
    } else fileContextCacheStats.bypasses += 1;
    const symbols = await parseFileSymbols(filePath, content);
    const context = { symbols, outline: buildOutline(symbols), topComments: extractTopComments(content) };
    if (cacheKey) {
        fileContextCache.set(cacheKey, context);
        if (fileContextCache.has(cacheKey)) fileContextCacheStats.sets += 1;
        else fileContextCacheStats.rejected += 1;
    }
    return context;
}

/** @param {FileContext} context @param {{ maxItems?: number; maxBytes?: number; includeImports?: boolean; includeExports?: boolean; includeOutline?: boolean; includeTopComments?: boolean }} [options] */
export function windowFileContext(context, options = {}) {
    const maxItems =
        Number.isFinite(options.maxItems) && Number(options.maxItems) > 0
            ? Math.min(5_000, Math.floor(Number(options.maxItems)))
            : 500;
    const maxBytes =
        Number.isFinite(options.maxBytes) && Number(options.maxBytes) > 0
            ? Math.min(4 * 1024 * 1024, Math.floor(Number(options.maxBytes)))
            : 512 * 1024;
    let returnedContentBytes = 0;
    /** @template T @param {readonly T[]} items @param {boolean} included @returns {T[]} */
    const take = (items, included) => {
        if (!included) return [];
        /** @type {T[]} */ const selected = [];
        for (const item of items) {
            if (selected.length >= maxItems) break;
            const serialized = typeof item === 'string' ? item : JSON.stringify(item);
            const itemBytes = utf8ByteLength(serialized, 'parser context output item');
            if (returnedContentBytes + itemBytes > maxBytes) break;
            selected.push(item);
            returnedContentBytes += itemBytes;
        }
        return selected;
    };
    const included = {
        symbols: true,
        imports: options.includeImports !== false,
        exports: options.includeExports !== false,
        outline: options.includeOutline !== false,
        topComments: options.includeTopComments === true,
    };
    const totalCounts = {
        symbols: context.symbols.symbols.length,
        imports: context.symbols.imports.length,
        exports: context.symbols.exports.length,
        outline: context.outline.length,
        topComments: context.topComments.length,
    };
    const symbols = take(context.symbols.symbols, included.symbols);
    const imports = take(context.symbols.imports, included.imports);
    const exports = take(context.symbols.exports, included.exports);
    const outline = take(context.outline, included.outline);
    const topComments = take(context.topComments, included.topComments);
    const returnedCounts = {
        symbols: symbols.length,
        imports: imports.length,
        exports: exports.length,
        outline: outline.length,
        topComments: topComments.length,
    };
    return {
        symbols,
        imports,
        exports,
        outline,
        topComments,
        maxItems,
        maxBytes,
        returnedContentBytes,
        totalCounts,
        returnedCounts,
        truncated: /** @type {(keyof typeof totalCounts)[]} */ (Object.keys(totalCounts)).some(
            (key) => included[key] && totalCounts[key] > returnedCounts[key],
        ),
    };
}
