// @ts-check
/**
 * Line-offset cache for UTF-8 text snapshots.
 *
 * This cache sits below MCP and above full-text window shaping. It does not cache file contents; it caches
 * newline-derived character offsets for already validated text snapshots so repeated `readText(..., { startLine,
 * endLine })` calls avoid `text.split('\n')` over the whole file.
 *
 * @module copilot/infra/filesystem/read/cache/line-offset-runtime
 */

import { collectPhysicalLineStarts, slicePhysicalTextLines } from '#copilot/infra/internal/platform';
import { normalizePathResourceKey } from '#copilot/infra/internal/policy';
import path from 'node:path';

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_TEXT_CHARS = 2_000_000;
const DEFAULT_MAX_CACHE_BYTES = 16 * 1024 * 1024;
const LINE_OFFSET_CACHE_DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] */
export function readLineOffsetCacheConfig(env = {}) {
    const enabledValue = String(env['IO_LINE_OFFSET_CACHE_ENABLED'] ?? '1')
        .trim()
        .toLowerCase();
    const maxEntries = Number(env['IO_LINE_OFFSET_CACHE_MAX_ENTRIES'] ?? DEFAULT_MAX_ENTRIES);
    const maxTextChars = Number(env['IO_LINE_OFFSET_CACHE_MAX_TEXT_CHARS'] ?? DEFAULT_MAX_TEXT_CHARS);
    const maxBytes = Number(env['IO_LINE_OFFSET_CACHE_MAX_BYTES'] ?? DEFAULT_MAX_CACHE_BYTES);
    return Object.freeze({
        enabled: !LINE_OFFSET_CACHE_DISABLED_VALUES.has(enabledValue),
        maxEntries:
            Number.isFinite(maxEntries) && maxEntries > 0 ? Math.max(16, Math.trunc(maxEntries)) : DEFAULT_MAX_ENTRIES,
        maxTextChars:
            Number.isFinite(maxTextChars) && maxTextChars > 0
                ? Math.max(4096, Math.trunc(maxTextChars))
                : DEFAULT_MAX_TEXT_CHARS,
        maxBytes:
            Number.isFinite(maxBytes) && maxBytes > 0
                ? Math.max(1024 * 1024, Math.trunc(maxBytes))
                : DEFAULT_MAX_CACHE_BYTES,
    });
}

/**
 * @typedef {object} LineOffsetEntry
 * @property {string} path
 * @property {number} sizeBytes
 * @property {number} mtimeMs
 * @property {number} textLength
 * @property {Uint32Array} starts
 * @property {number} totalLines
 * @property {number} estimatedBytes
 */

/**
 * @param {{ invalidationBus:{registerHook:(hook:(filePath:string,event:{recursive:boolean;source:string})=>void)=>()=>void}; config?:ReturnType<typeof readLineOffsetCacheConfig> }} options
 */
export function createLineOffsetCacheRuntime(options) {
    if (!options?.invalidationBus) throw new TypeError('createLineOffsetCacheRuntime requires { invalidationBus }.');
    const invalidationBus = options.invalidationBus;
    const config = options.config ?? readLineOffsetCacheConfig({});
    /** @type {Map<string, LineOffsetEntry>} */
    const lineOffsetCache = new Map();
    let lineOffsetCacheBytes = 0;

    const lineOffsetCacheStats = {
        hits: 0,
        misses: 0,
        sets: 0,
        stale: 0,
        evictions: 0,
        clears: 0,
        bypasses: 0,
        busInvalidations: 0,
        recursiveInvalidations: 0,
        rejected: 0,
    };

    /** @type {(() => void) | null} */
    let lineOffsetInvalidationUnregister = null;

    /**
     * @returns {Record<string, number | boolean> & {
     *     enabled: boolean;
     *     size: number;
     *     sizeBytes: number;
     *     maxEntries: number;
     *     maxTextChars: number;
     *     maxBytes: number;
     * }}
     */
    function getLineOffsetCacheStats() {
        return {
            ...lineOffsetCacheStats,
            enabled: config.enabled,
            size: lineOffsetCache.size,
            sizeBytes: lineOffsetCacheBytes,
            maxEntries: config.maxEntries,
            maxTextChars: config.maxTextChars,
            maxBytes: config.maxBytes,
        };
    }

    /**
     * @returns {void}
     */
    function clearLineOffsetCache() {
        lineOffsetCache.clear();
        lineOffsetCacheBytes = 0;
        for (const key of Object.keys(lineOffsetCacheStats)) {
            lineOffsetCacheStats[/** @type {keyof typeof lineOffsetCacheStats} */ (key)] = 0;
        }
        lineOffsetInvalidationUnregister?.();
        lineOffsetInvalidationUnregister = null;
    }

    /**
     * Ensure line-offset entries are cleared when canonical IO invalidation events are published.
     *
     * @returns {void}
     */
    function ensureLineOffsetCacheInvalidationHook() {
        if (lineOffsetInvalidationUnregister) return;
        lineOffsetInvalidationUnregister = invalidationBus.registerHook((filePath, event) => {
            const removed = event.recursive
                ? invalidateLineOffsetCacheSubtree(filePath)
                : invalidateLineOffsetCachePath(filePath);
            lineOffsetCacheStats.busInvalidations += 1;
            if (event.recursive) lineOffsetCacheStats.recursiveInvalidations += 1;
            void removed;
        });
    }

    /**
     * @param {string} filePath
     * @returns {number}
     */
    function invalidateLineOffsetCachePath(filePath) {
        const normalizedPath = normalizePathResourceKey(filePath);
        const removed = clearLineOffsetCacheByPrefixes([`${normalizedPath}\u0000`]);
        lineOffsetCacheStats.clears += removed;
        return removed;
    }

    /**
     * @param {string} filePath
     * @returns {number}
     */
    function invalidateLineOffsetCacheSubtree(filePath) {
        const normalizedPath = normalizePathResourceKey(filePath);
        const removed = clearLineOffsetCacheByPrefixes([`${normalizedPath}\u0000`, `${normalizedPath}${path.sep}`]);
        lineOffsetCacheStats.clears += removed;
        return removed;
    }

    /**
     * @param {string[]} prefixes
     * @returns {number}
     */
    function clearLineOffsetCacheByPrefixes(prefixes) {
        let removed = 0;
        for (const key of [...lineOffsetCache.keys()]) {
            if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
            deleteLineOffsetCacheEntry(key);
            removed += 1;
        }
        return removed;
    }

    /**
     * Return a line window using cached newline offsets when possible.
     *
     * @param {string} filePath
     * @param {string} text
     * @param {{ sizeBytes: number; mtimeMs: number | null | undefined }} fingerprint
     * @param {{ startLine?: number | undefined; endLine?: number | undefined }} [window]
     * @returns {{
     *     content: string;
     *     totalLines: number;
     *     returnedLines: { start: number; end: number };
     *     cache: 'line-offset-hit' | 'line-offset-miss' | 'line-offset-bypass';
     * }}
     */
    function sliceTextByCachedLineOffsets(filePath, text, fingerprint, window = {}) {
        ensureLineOffsetCacheInvalidationHook();
        const sizeBytes = typeof fingerprint.sizeBytes === 'number' ? fingerprint.sizeBytes : Number.NaN;
        const mtimeMs = typeof fingerprint.mtimeMs === 'number' ? fingerprint.mtimeMs : Number.NaN;
        if (
            !config.enabled ||
            !Number.isFinite(sizeBytes) ||
            !Number.isFinite(mtimeMs) ||
            text.length > config.maxTextChars
        ) {
            lineOffsetCacheStats.bypasses += 1;
            return { ...slicePhysicalTextLines(text, window), cache: 'line-offset-bypass' };
        }

        const normalizedPath = normalizePathResourceKey(filePath);
        const key = buildLineOffsetCacheKey(normalizedPath, sizeBytes, mtimeMs, text.length);
        let entry = lineOffsetCache.get(key);
        /** @type {'line-offset-hit' | 'line-offset-miss'} */
        let cacheState = 'line-offset-miss';
        if (entry && entry.textLength === text.length && entry.sizeBytes === sizeBytes && entry.mtimeMs === mtimeMs) {
            lineOffsetCacheStats.hits += 1;
            cacheState = 'line-offset-hit';
            lineOffsetCache.delete(key);
            lineOffsetCache.set(key, entry);
        } else {
            if (entry) {
                deleteLineOffsetCacheEntry(key);
                lineOffsetCacheStats.stale += 1;
            }
            lineOffsetCacheStats.misses += 1;
            const starts = collectPhysicalLineStarts(text);
            entry = {
                path: normalizedPath,
                sizeBytes,
                mtimeMs,
                textLength: text.length,
                starts,
                totalLines: starts.length,
                estimatedBytes: starts.byteLength + normalizedPath.length * 2 + 128,
            };
            if (entry.estimatedBytes <= config.maxBytes) {
                lineOffsetCache.set(key, entry);
                lineOffsetCacheBytes += entry.estimatedBytes;
                lineOffsetCacheStats.sets += 1;
                trimLineOffsetCache();
            } else {
                lineOffsetCacheStats.rejected += 1;
            }
        }
        return { ...sliceTextByOffsets(text, entry.starts, window), cache: cacheState };
    }

    /**
     * @param {string} text
     * @param {Uint32Array} starts
     * @param {{ startLine?: number | undefined; endLine?: number | undefined }} window
     * @returns {{ content: string; totalLines: number; returnedLines: { start: number; end: number } }}
     */
    function sliceTextByOffsets(text, starts, window) {
        const totalLines = starts.length;
        const requestedStart = Math.max(1, Math.trunc(window.startLine ?? 1));
        const requestedEnd = window.endLine === undefined ? totalLines : Math.trunc(window.endLine);
        const sliceStart = Math.min(requestedStart, totalLines + 1);
        const sliceEnd = sliceStart > totalLines ? totalLines : Math.min(requestedEnd, totalLines);
        if (sliceStart > totalLines || sliceEnd < sliceStart) {
            return { content: '', totalLines, returnedLines: { start: sliceStart, end: sliceEnd } };
        }
        const contentStart = starts[sliceStart - 1] ?? text.length;
        const contentEnd =
            sliceEnd >= totalLines
                ? text.length
                : Math.max(contentStart, lineContentEndFromNextStart(text, starts[sliceEnd] ?? text.length));
        return {
            content: text.slice(contentStart, contentEnd),
            totalLines,
            returnedLines: { start: sliceStart, end: sliceEnd },
        };
    }

    /**
     * @param {string} text
     * @param {number} nextStart
     * @returns {number}
     */
    function lineContentEndFromNextStart(text, nextStart) {
        let end = nextStart;
        if (text.charCodeAt(end - 1) === 10) end -= 1;
        if (text.charCodeAt(end - 1) === 13) end -= 1;
        return end;
    }

    /**
     * @param {string} filePath
     * @param {number} sizeBytes
     * @param {number} mtimeMs
     * @param {number} textLength
     * @returns {string}
     */
    function buildLineOffsetCacheKey(filePath, sizeBytes, mtimeMs, textLength) {
        return `${filePath}\u0000${sizeBytes}\u0000${mtimeMs}\u0000${textLength}`;
    }

    function trimLineOffsetCache() {
        const maxEntries = config.maxEntries;
        const maxBytes = config.maxBytes;
        while (lineOffsetCache.size > maxEntries || lineOffsetCacheBytes > maxBytes) {
            const oldest = lineOffsetCache.keys().next().value;
            if (typeof oldest !== 'string') break;
            deleteLineOffsetCacheEntry(oldest);
            lineOffsetCacheStats.evictions += 1;
        }
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    function deleteLineOffsetCacheEntry(key) {
        const entry = lineOffsetCache.get(key);
        if (!entry) return false;
        lineOffsetCache.delete(key);
        lineOffsetCacheBytes = Math.max(0, lineOffsetCacheBytes - entry.estimatedBytes);
        return true;
    }

    return Object.freeze({
        stats: getLineOffsetCacheStats,
        reset: clearLineOffsetCache,
        ensureInvalidationHook: ensureLineOffsetCacheInvalidationHook,
        invalidatePath: invalidateLineOffsetCachePath,
        invalidateSubtree: invalidateLineOffsetCacheSubtree,
        slice: sliceTextByCachedLineOffsets,
        dispose: clearLineOffsetCache,
    });
}
