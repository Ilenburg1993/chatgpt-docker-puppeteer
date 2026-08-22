// @ts-check
/** File-context projection, bounded windowing and content-addressed context cache. */

import { buildOutline, extractTopComments } from '#copilot/infra/internal/code-analysis';
import { sha256 } from '#copilot/infra/internal/platform';
import { normalizeParserPath } from '../foundation/index.js';
import { parseFileSymbols } from '../parse/index.js';

/** @typedef {import('../foundation/index.js').FileContext} FileContext */

/** @param {string} filePath @param {string} content @param {string | undefined} suppliedContentHash @param {ReturnType<typeof import('../cache/runtime/index.js').createParserCacheRuntime>} parserCacheRuntime */
function buildCacheKey(filePath, content, suppliedContentHash, parserCacheRuntime) {
    if (!parserCacheRuntime.isFileContextEnabled()) return null;
    const normalized = normalizeParserPath(filePath);
    const normalizedSuppliedHash =
        typeof suppliedContentHash === 'string' && /^[0-9a-f]{64}$/iu.test(suppliedContentHash)
            ? suppliedContentHash.toLowerCase()
            : null;
    const hash = normalizedSuppliedHash ?? sha256(content);
    if (normalizedSuppliedHash) parserCacheRuntime.fileContextStats.hashReuses += 1;
    else parserCacheRuntime.fileContextStats.hashComputations += 1;
    return `${normalized}\u0000${content.length}\u0000${hash}`;
}

/** @param {string} filePath @param {string} content @param {{ contentHash?: string; parserCacheRuntime?: ReturnType<typeof import('../cache/runtime/index.js').createParserCacheRuntime>; parserConfig?: ReturnType<typeof import('../foundation/index.js').readParserProcessConfig> }} [options] @returns {Promise<FileContext>} */
export async function parseFileForContext(filePath, content, options = {}) {
    const parserCacheRuntime = options.parserCacheRuntime ?? null;
    if (!parserCacheRuntime) {
        const symbols = await parseFileSymbols(filePath, content, {
            ...(options.parserConfig ? { parserConfig: options.parserConfig } : {}),
        });
        return { symbols, outline: buildOutline(symbols), topComments: extractTopComments(content) };
    }
    parserCacheRuntime.ensureInvalidationHook();
    const fileContextCache = parserCacheRuntime.fileContextCache;
    const fileContextCacheStats = parserCacheRuntime.fileContextStats;
    const cacheKey = buildCacheKey(filePath, content, options.contentHash, parserCacheRuntime);
    if (cacheKey) {
        const cached = /** @type {FileContext | undefined} */ (fileContextCache.get(cacheKey));
        if (cached) {
            fileContextCacheStats.hits += 1;
            return cached;
        }
        fileContextCacheStats.misses += 1;
    } else fileContextCacheStats.bypasses += 1;
    const symbols = await parseFileSymbols(filePath, content, {
        parserConfig: parserCacheRuntime.parserConfig,
        ...(parserCacheRuntime.workerRuntime ? { workerRuntime: parserCacheRuntime.workerRuntime } : {}),
    });
    const context = { symbols, outline: buildOutline(symbols), topComments: extractTopComments(content) };
    if (cacheKey) {
        fileContextCache.set(cacheKey, context);
        if (fileContextCache.has(cacheKey)) fileContextCacheStats.sets += 1;
        else fileContextCacheStats.rejected += 1;
    }
    return context;
}
