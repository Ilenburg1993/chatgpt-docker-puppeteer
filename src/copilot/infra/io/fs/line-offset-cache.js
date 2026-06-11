// @ts-check
/**
 * Line-offset cache for UTF-8 text snapshots.
 *
 * This cache sits below MCP and above full-text window shaping. It does not cache file contents; it caches newline-derived
 * character offsets for already validated text snapshots so repeated `readText(..., { startLine, endLine })` calls avoid
 * `text.split('\n')` over the whole file.
 *
 * @module copilot/infra/io/fs/line-offset-cache
 */

import { registerIoInvalidationHook } from '../invalidation/bus.js';
import path from 'node:path';

const MAX_LINE_OFFSET_CACHE_ENTRIES = Number(process.env['IO_LINE_OFFSET_CACHE_MAX_ENTRIES'] ?? 256);
const DEFAULT_MAX_TEXT_CHARS = Number(process.env['IO_LINE_OFFSET_CACHE_MAX_TEXT_CHARS'] ?? 2_000_000);
const LINE_OFFSET_CACHE_DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);

/**
 * @typedef {object} LineOffsetEntry
 * @property {string} path
 * @property {number} sizeBytes
 * @property {number} mtimeMs
 * @property {number} textLength
 * @property {number[]} starts
 * @property {number} totalLines
 */

/** @type {Map<string, LineOffsetEntry>} */
const lineOffsetCache = new Map();

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
};

/** @type {(() => void) | null} */
let lineOffsetInvalidationUnregister = null;

ensureLineOffsetCacheInvalidationHook();

/**
 * @returns {Record<string, number | boolean> & { enabled: boolean; size: number; maxEntries: number; maxTextChars: number }}
 */
export function getLineOffsetCacheStats() {
    return {
        ...lineOffsetCacheStats,
        enabled: isLineOffsetCacheEnabled(),
        size: lineOffsetCache.size,
        maxEntries: readLineOffsetCacheMaxEntries(),
        maxTextChars: readLineOffsetCacheMaxTextChars(),
    };
}

/**
 * @returns {void}
 */
export function resetLineOffsetCacheForTest() {
    lineOffsetCache.clear();
    for (const key of Object.keys(lineOffsetCacheStats)) {
        lineOffsetCacheStats[/** @type {keyof typeof lineOffsetCacheStats} */ (key)] = 0;
    }
    lineOffsetInvalidationUnregister?.();
    lineOffsetInvalidationUnregister = null;
    ensureLineOffsetCacheInvalidationHook();
}

/**
 * Ensure line-offset entries are cleared when canonical IO invalidation events are published.
 *
 * @returns {void}
 */
export function ensureLineOffsetCacheInvalidationHook() {
    if (lineOffsetInvalidationUnregister) return;
    lineOffsetInvalidationUnregister = registerIoInvalidationHook((filePath, event) => {
        const removed = event.recursive ? invalidateLineOffsetCacheSubtree(filePath) : invalidateLineOffsetCachePath(filePath);
        lineOffsetCacheStats.busInvalidations += 1;
        if (event.recursive) lineOffsetCacheStats.recursiveInvalidations += 1;
        void removed;
    });
}

/**
 * @param {string} filePath
 * @returns {number}
 */
export function invalidateLineOffsetCachePath(filePath) {
    const removed = clearLineOffsetCacheByPrefixes([`${filePath}\u0000`]);
    lineOffsetCacheStats.clears += removed;
    return removed;
}

/**
 * @param {string} filePath
 * @returns {number}
 */
export function invalidateLineOffsetCacheSubtree(filePath) {
    const removed = clearLineOffsetCacheByPrefixes([`${filePath}\u0000`, `${filePath}${path.sep}`]);
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
        lineOffsetCache.delete(key);
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
 * @returns {{ content: string; totalLines: number; returnedLines: { start: number; end: number }; cache: 'line-offset-hit' | 'line-offset-miss' | 'line-offset-bypass' }}
 */
export function sliceTextByCachedLineOffsets(filePath, text, fingerprint, window = {}) {
    const sizeBytes = typeof fingerprint.sizeBytes === 'number' ? fingerprint.sizeBytes : Number.NaN;
    const mtimeMs = typeof fingerprint.mtimeMs === 'number' ? fingerprint.mtimeMs : Number.NaN;
    if (
        !isLineOffsetCacheEnabled() ||
        !Number.isFinite(sizeBytes) ||
        !Number.isFinite(mtimeMs) ||
        text.length > readLineOffsetCacheMaxTextChars()
    ) {
        lineOffsetCacheStats.bypasses += 1;
        return { ...sliceTextBySplit(text, window), cache: 'line-offset-bypass' };
    }

    const key = buildLineOffsetCacheKey(filePath, sizeBytes, mtimeMs, text.length);
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
            lineOffsetCache.delete(key);
            lineOffsetCacheStats.stale += 1;
        }
        lineOffsetCacheStats.misses += 1;
        entry = {
            path: filePath,
            sizeBytes,
            mtimeMs,
            textLength: text.length,
            starts: buildLineStarts(text),
            totalLines: 0,
        };
        entry.totalLines = entry.starts.length;
        lineOffsetCache.set(key, entry);
        lineOffsetCacheStats.sets += 1;
        trimLineOffsetCache();
    }
    return { ...sliceTextByOffsets(text, entry.starts, window), cache: cacheState };
}

/**
 * @param {string} text
 * @returns {number[]}
 */
function buildLineStarts(text) {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) starts.push(index + 1);
    }
    return starts;
}

/**
 * @param {string} text
 * @param {number[]} starts
 * @param {{ startLine?: number | undefined; endLine?: number | undefined }} window
 * @returns {{ content: string; totalLines: number; returnedLines: { start: number; end: number } }}
 */
function sliceTextByOffsets(text, starts, window) {
    const totalLines = starts.length;
    const requestedStart = Math.max(1, window.startLine ?? 1);
    const sliceStart = Math.min(requestedStart, totalLines + 1);
    const sliceEnd = sliceStart > totalLines ? totalLines : Math.min(window.endLine ?? totalLines, totalLines);
    if (sliceStart > totalLines) return { content: '', totalLines, returnedLines: { start: sliceStart, end: sliceEnd } };
    const contentStart = starts[sliceStart - 1] ?? text.length;
    const contentEnd = sliceEnd >= totalLines ? text.length : Math.max(contentStart, (starts[sliceEnd] ?? text.length) - 1);
    return {
        content: text.slice(contentStart, contentEnd),
        totalLines,
        returnedLines: { start: sliceStart, end: sliceEnd },
    };
}

/**
 * @param {string} text
 * @param {{ startLine?: number | undefined; endLine?: number | undefined }} window
 * @returns {{ content: string; totalLines: number; returnedLines: { start: number; end: number } }}
 */
function sliceTextBySplit(text, window) {
    const lines = text.split('\n');
    const totalLines = lines.length;
    const requestedStart = Math.max(1, window.startLine ?? 1);
    const sliceStart = Math.min(requestedStart, totalLines + 1);
    const sliceEnd = sliceStart > totalLines ? totalLines : Math.min(window.endLine ?? totalLines, totalLines);
    return {
        content: sliceStart > totalLines ? '' : lines.slice(sliceStart - 1, sliceEnd).join('\n'),
        totalLines,
        returnedLines: { start: sliceStart, end: sliceEnd },
    };
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

/**
 * @returns {boolean}
 */
function isLineOffsetCacheEnabled() {
    const value = String(process.env['IO_LINE_OFFSET_CACHE_ENABLED'] ?? '1').trim().toLowerCase();
    return !LINE_OFFSET_CACHE_DISABLED_VALUES.has(value);
}

function trimLineOffsetCache() {
    const maxEntries = readLineOffsetCacheMaxEntries();
    while (lineOffsetCache.size > maxEntries) {
        const oldest = lineOffsetCache.keys().next().value;
        if (typeof oldest !== 'string') break;
        lineOffsetCache.delete(oldest);
        lineOffsetCacheStats.evictions += 1;
    }
}

/**
 * @returns {number}
 */
function readLineOffsetCacheMaxEntries() {
    return Number.isFinite(MAX_LINE_OFFSET_CACHE_ENTRIES) && MAX_LINE_OFFSET_CACHE_ENTRIES > 0
        ? Math.max(16, Math.trunc(MAX_LINE_OFFSET_CACHE_ENTRIES))
        : 256;
}

/**
 * @returns {number}
 */
function readLineOffsetCacheMaxTextChars() {
    return Number.isFinite(DEFAULT_MAX_TEXT_CHARS) && DEFAULT_MAX_TEXT_CHARS > 0
        ? Math.max(4096, Math.trunc(DEFAULT_MAX_TEXT_CHARS))
        : 2_000_000;
}
