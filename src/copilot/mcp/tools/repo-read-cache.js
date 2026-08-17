// @ts-check
/**
 * MCP repo read response cache.
 *
 * This cache is intentionally above the canonical IO cache: it stores already-shaped MCP tool payloads for repeated
 * `repo_read_file` and `repo_read_file_chunks` calls. The lower IO L1/L2 cache stores full file bytes/text; this module
 * stores resolved windows/chunks plus their text response.
 *
 * @module copilot/mcp/tools/repo-read-cache
 */

import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { registerIoInvalidationHook } from '#copilot/infra/io/invalidation/bus';
import { getMcpWorkspaceRoot } from '#copilot/mcp/control-plane';
import path from 'node:path';

const { readTextValidated, readTextChunksValidated, statPathValidated } = createWorkspaceIo({
    workspaceRoot: getMcpWorkspaceRoot(),
});

const REPO_READ_FILE_CACHE_MAX_ENTRIES = 128;
const DEFAULT_REPO_READ_FILE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const HARD_REPO_READ_FILE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * @typedef {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number; validatedAtMs: number; structured: Record<string, unknown>; text: string; weightBytes: number }} RepoReadCacheEntry
 */

/** @type {Map<string, RepoReadCacheEntry>} */
const repoReadFileResultCache = new Map();
/** @type {Map<string, RepoReadCacheEntry>} */
const repoReadFileChunkCache = new Map();

const repoReadCacheStats = {
    hits: 0,
    misses: 0,
    stale: 0,
    trustWindowHits: 0,
    sets: 0,
    evictions: 0,
    clears: 0,
    singleflightLeaders: 0,
    singleflightJoins: 0,
    singleflightErrors: 0,
    chunkHits: 0,
    chunkMisses: 0,
    chunkStale: 0,
    chunkTrustWindowHits: 0,
    chunkSets: 0,
    chunkEvictions: 0,
    chunkClears: 0,
    chunkSingleflightLeaders: 0,
    chunkSingleflightJoins: 0,
    chunkSingleflightErrors: 0,
    busInvalidations: 0,
    recursiveInvalidations: 0,
};

/**
 * @typedef {{ structured: Record<string, unknown>; text: string }} RepoReadCacheResult
 */

/** @type {Map<string, Promise<RepoReadCacheResult>>} */
const repoReadFileInflight = new Map();
/** @type {Map<string, Promise<RepoReadCacheResult>>} */
const repoReadFileChunkInflight = new Map();

/** @type {(() => void) | null} */
let repoReadCacheInvalidationUnregister = null;

ensureRepoReadCacheInvalidationHook();

/**
 * Return MCP repo read response-cache stats. Kept under the historical function name for runtime-health compatibility.
 *
 * @returns {Record<string, number> & { size: number; chunkSize: number; bytes: number; chunkBytes: number; maxBytes: number; trustWindowMs: number }}
 */
export function readRepoReadFileResultCacheStats() {
    return {
        ...repoReadCacheStats,
        size: repoReadFileResultCache.size,
        chunkSize: repoReadFileChunkCache.size,
        bytes: sumRepoReadCacheWeightBytes(repoReadFileResultCache),
        chunkBytes: sumRepoReadCacheWeightBytes(repoReadFileChunkCache),
        maxBytes: readRepoReadCacheMaxBytes(),
        trustWindowMs: readRepoReadTrustWindowMs(),
    };
}

/**
 * Clear all MCP read response-cache entries for one resolved absolute path.
 *
 * @param {string} resolvedPath
 * @returns {number}
 */
export function clearRepoReadFileResultCacheForResolvedPath(resolvedPath) {
    const removed = clearRepoReadCacheEntriesByPrefix(`${resolvedPath}\u0000`);
    repoReadCacheStats.clears += removed.file;
    repoReadCacheStats.chunkClears += removed.chunk;
    return removed.file + removed.chunk;
}

/**
 * Clear all MCP read response-cache entries under a resolved absolute subtree.
 *
 * @param {string} resolvedPath
 * @returns {number}
 */
export function clearRepoReadFileResultCacheForResolvedSubtree(resolvedPath) {
    const exact = clearRepoReadCacheEntriesByPrefix(`${resolvedPath}\u0000`);
    const subtree = clearRepoReadCacheEntriesByPrefix(`${resolvedPath}${path.sep}`);
    const file = exact.file + subtree.file;
    const chunk = exact.chunk + subtree.chunk;
    repoReadCacheStats.clears += file;
    repoReadCacheStats.chunkClears += chunk;
    return file + chunk;
}

/**
 * Read a UTF-8 file/window and cache the already-shaped MCP payload.
 *
 * @param {{ resolved: string; relative: string; validatedReadPath?: unknown }} resolved
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @returns {Promise<{ structured: Record<string, unknown>; text: string }>}
 */
export async function readRepoFileWithValidatedResultCache(resolved, startLine, endLine) {
    const key = buildRepoReadFileCacheKey(resolved.resolved, startLine, endLine);
    const cached = await getValidatedRepoReadCacheEntry(
        repoReadFileResultCache,
        key,
        resolved.validatedReadPath,
        {
            hitStat: 'hits',
            trustWindowHitStat: 'trustWindowHits',
            staleStat: 'stale',
        },
    );
    if (cached) return { structured: cloneStructuredReadFileResult(cached.structured), text: cached.text };

    return runRepoReadSingleflight(repoReadFileInflight, key, {
        leaderStat: 'singleflightLeaders',
        joinStat: 'singleflightJoins',
        errorStat: 'singleflightErrors',
    }, async () => {
        repoReadCacheStats.misses += 1;
        const snapshot = await readTextValidated(resolved.validatedReadPath, {
            ...(startLine !== undefined ? { startLine } : {}),
            ...(endLine !== undefined ? { endLine } : {}),
        });
        const structured = {
            success: true,
            path: resolved.relative,
            content: snapshot.content,
            sha256: snapshot.contentHash,
            returnedSha256: snapshot.returnedContentHash,
            bytes: snapshot.bytesRead,
            totalLines: snapshot.totalLines,
            returnedLines: snapshot.returnedLines,
        };
        const sizeBytes = Number(snapshot.sizeBytes ?? snapshot.bytesRead);
        const mtimeMs = Number(snapshot.mtimeMs);
        const ctimeMs = Number(snapshot.ctimeMs);
        const dev = Number(snapshot.dev);
        const ino = Number(snapshot.ino);
        if ([sizeBytes, mtimeMs, ctimeMs, dev, ino].every(Number.isFinite)) {
            rememberRepoReadFileCacheEntry(key, {
                sizeBytes,
                mtimeMs,
                ctimeMs,
                dev,
                ino,
                validatedAtMs: Date.now(),
                structured,
                text: snapshot.content,
                weightBytes: estimateRepoReadCacheEntryWeightBytes(structured, snapshot.content),
            });
        }
        return { structured, text: snapshot.content };
    });
}

/**
 * Read line chunks and cache the already-shaped MCP payload.
 *
 * @param {{ resolved: string; relative: string; validatedReadPath?: unknown }} resolved
 * @param {number} effectiveStartLine
 * @param {number | undefined} endLine
 * @param {number} chunkLines
 * @param {number | undefined} highWaterMark
 * @param {string | undefined} cursor
 * @returns {Promise<{ structured: Record<string, unknown>; text: string }>}
 */
export async function readRepoFileChunksWithValidatedResultCache(
    resolved,
    effectiveStartLine,
    endLine,
    chunkLines,
    highWaterMark,
    cursor,
) {
    const key = buildRepoReadFileChunkCacheKey(resolved.resolved, effectiveStartLine, endLine, chunkLines, highWaterMark);
    const cached = await getValidatedRepoReadCacheEntry(
        repoReadFileChunkCache,
        key,
        resolved.validatedReadPath,
        {
            hitStat: 'chunkHits',
            trustWindowHitStat: 'chunkTrustWindowHits',
            staleStat: 'chunkStale',
        },
    );
    if (cached) return { structured: cloneStructuredReadFileResult(cached.structured), text: cached.text };

    return runRepoReadSingleflight(repoReadFileChunkInflight, key, {
        leaderStat: 'chunkSingleflightLeaders',
        joinStat: 'chunkSingleflightJoins',
        errorStat: 'chunkSingleflightErrors',
    }, async () => {
        repoReadCacheStats.chunkMisses += 1;
        const snapshot = await readTextChunksValidated(resolved.validatedReadPath, {
            startLine: effectiveStartLine,
            ...(endLine !== undefined ? { endLine } : {}),
            chunkLines,
            ...(highWaterMark !== undefined ? { highWaterMark } : {}),
        });
        const lastChunk = snapshot.chunks[snapshot.chunks.length - 1];
        const lastReturnedLine = lastChunk?.endLine ?? effectiveStartLine - 1;
        const nextCursor = snapshot.totalLinesKnown && lastReturnedLine < snapshot.totalLines ? String(lastReturnedLine + 1) : null;
        const text = snapshot.chunks.map((chunk) => chunk.content).join('\n');
        const structured = {
            success: true,
            path: resolved.relative,
            chunks: snapshot.chunks,
            chunkCount: snapshot.chunks.length,
            returnedChunkCount: snapshot.returnedChunkCount ?? snapshot.chunks.length,
            returnedLineCount: snapshot.returnedLineCount ?? 0,
            chunkLines,
            startLine: effectiveStartLine,
            endLine: endLine ?? null,
            totalLines: snapshot.totalLines,
            totalLinesKnown: snapshot.totalLinesKnown,
            lastScannedLine: snapshot.lastScannedLine ?? snapshot.totalLines,
            fileTotalLines: snapshot.fileTotalLines ?? (snapshot.totalLinesKnown ? snapshot.totalLines : null),
            fileTotalLinesKnown: snapshot.fileTotalLinesKnown ?? snapshot.totalLinesKnown,
            bytes: snapshot.bytesRead,
            sizeBytes: snapshot.sizeBytes,
            nextCursor,
            cursor: cursor ?? null,
            engine: snapshot.io.engine,
        };
        const sizeBytes = Number(snapshot.sizeBytes ?? snapshot.bytesRead);
        const mtimeMs = Number(snapshot.mtimeMs);
        const ctimeMs = Number(snapshot.ctimeMs);
        const dev = Number(snapshot.dev);
        const ino = Number(snapshot.ino);
        if ([sizeBytes, mtimeMs, ctimeMs, dev, ino].every(Number.isFinite)) {
            rememberRepoReadFileChunkCacheEntry(key, {
                sizeBytes,
                mtimeMs,
                ctimeMs,
                dev,
                ino,
                validatedAtMs: Date.now(),
                structured,
                text,
                weightBytes: estimateRepoReadCacheEntryWeightBytes(structured, text),
            });
        }
        return { structured, text };
    });
}

/**
 * Test-only reset helper. Runtime code should invalidate by resolved path.
 *
 * @returns {void}
 */
export function resetRepoReadResponseCacheForTest() {
    repoReadFileResultCache.clear();
    repoReadFileChunkCache.clear();
    repoReadFileInflight.clear();
    repoReadFileChunkInflight.clear();
    for (const key of Object.keys(repoReadCacheStats)) {
        repoReadCacheStats[/** @type {keyof typeof repoReadCacheStats} */ (key)] = 0;
    }
    repoReadCacheInvalidationUnregister?.();
    repoReadCacheInvalidationUnregister = null;
    ensureRepoReadCacheInvalidationHook();
}

/**
 * Ensure the MCP response cache also reacts to canonical IO invalidation events.
 *
 * @returns {void}
 */
export function ensureRepoReadCacheInvalidationHook() {
    if (repoReadCacheInvalidationUnregister) return;
    repoReadCacheInvalidationUnregister = registerIoInvalidationHook((filePath, event) => {
        const removed = event.recursive
            ? clearRepoReadFileResultCacheForResolvedSubtree(filePath)
            : clearRepoReadFileResultCacheForResolvedPath(filePath);
        repoReadCacheStats.busInvalidations += 1;
        if (event.recursive) repoReadCacheStats.recursiveInvalidations += 1;
        void removed;
    });
}

/**
 * @param {string} prefix
 * @returns {{ file: number; chunk: number }}
 */
function clearRepoReadCacheEntriesByPrefix(prefix) {
    let file = 0;
    for (const key of [...repoReadFileResultCache.keys()]) {
        if (!key.startsWith(prefix)) continue;
        repoReadFileResultCache.delete(key);
        file += 1;
    }
    let chunk = 0;
    for (const key of [...repoReadFileChunkCache.keys()]) {
        if (!key.startsWith(prefix)) continue;
        repoReadFileChunkCache.delete(key);
        chunk += 1;
    }
    return { file, chunk };
}

/**
 * @param {Map<string, RepoReadCacheEntry>} cache
 * @param {string} key
 * @param {unknown} validatedReadPath
 * @param {{ hitStat: 'hits' | 'chunkHits'; trustWindowHitStat: 'trustWindowHits' | 'chunkTrustWindowHits'; staleStat: 'stale' | 'chunkStale' }} stats
 * @returns {Promise<RepoReadCacheEntry | null>}
 */
async function getValidatedRepoReadCacheEntry(cache, key, validatedReadPath, stats) {
    const cached = cache.get(key);
    if (!cached) return null;
    const trustWindowMs = readRepoReadTrustWindowMs();
    if (trustWindowMs > 0 && Date.now() - cached.validatedAtMs <= trustWindowMs) {
        repoReadCacheStats[stats.hitStat] += 1;
        repoReadCacheStats[stats.trustWindowHitStat] += 1;
        cache.delete(key);
        cache.set(key, { ...cached, validatedAtMs: Date.now() });
        return cached;
    }
    const current = await statPathValidated(validatedReadPath).catch(() => null);
    const fileStats = current?.stats;
    if (
        fileStats?.isFile() &&
        fileStats.size === cached.sizeBytes &&
        fileStats.mtimeMs === cached.mtimeMs &&
        fileStats.ctimeMs === cached.ctimeMs &&
        Number(fileStats.dev) === cached.dev &&
        Number(fileStats.ino) === cached.ino
    ) {
        repoReadCacheStats[stats.hitStat] += 1;
        cache.delete(key);
        cache.set(key, { ...cached, validatedAtMs: Date.now() });
        return cached;
    }
    repoReadCacheStats[stats.staleStat] += 1;
    cache.delete(key);
    return null;
}

/**
 * @param {string} absolutePath
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @returns {string}
 */
function buildRepoReadFileCacheKey(absolutePath, startLine, endLine) {
    return `${absolutePath}\u0000${startLine ?? ''}\u0000${endLine ?? ''}`;
}

/**
 * @param {string} absolutePath
 * @param {number} startLine
 * @param {number | undefined} endLine
 * @param {number} chunkLines
 * @param {number | undefined} highWaterMark
 * @returns {string}
 */
function buildRepoReadFileChunkCacheKey(absolutePath, startLine, endLine, chunkLines, highWaterMark) {
    return `${absolutePath}\u0000chunks\u0000${startLine}\u0000${endLine ?? ''}\u0000${chunkLines}\u0000${highWaterMark ?? ''}`;
}

/**
 * @returns {number}
 */
function readRepoReadTrustWindowMs() {
    const value = Number(process.env['COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS'] ?? 0);
    return Number.isFinite(value) && value > 0 ? Math.min(5000, Math.floor(value)) : 0;
}

/**
 * @returns {number}
 */
function readRepoReadCacheMaxBytes() {
    const value = Number(process.env['COPILOT_MCP_REPO_READ_CACHE_MAX_BYTES'] ?? DEFAULT_REPO_READ_FILE_CACHE_MAX_BYTES);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_REPO_READ_FILE_CACHE_MAX_BYTES;
    return Math.min(HARD_REPO_READ_FILE_CACHE_MAX_BYTES, Math.floor(value));
}

/**
 * @param {Record<string, unknown>} structured
 * @param {string} text
 * @returns {number}
 */
/**
 * @param {RepoReadCacheResult} result
 * @returns {RepoReadCacheResult}
 */
function cloneRepoReadSingleflightResult(result) {
    return { structured: cloneStructuredReadFileResult(result.structured), text: result.text };
}

/**
 * @param {Map<string, Promise<RepoReadCacheResult>>} activeReads
 * @param {string} key
 * @param {Record<string, 'singleflightLeaders' | 'singleflightJoins' | 'singleflightErrors' | 'chunkSingleflightLeaders' | 'chunkSingleflightJoins' | 'chunkSingleflightErrors'>} stats
 * @param {() => Promise<RepoReadCacheResult>} loader
 * @returns {Promise<RepoReadCacheResult>}
 */
async function runRepoReadSingleflight(activeReads, key, stats, loader) {
    const currentRead = activeReads.get(key);
    if (currentRead) {
        repoReadCacheStats.singleflightJoins += activeReads === repoReadFileInflight ? 1 : 0;
        repoReadCacheStats.chunkSingleflightJoins += activeReads === repoReadFileChunkInflight ? 1 : 0;
        return cloneRepoReadSingleflightResult(await currentRead);
    }
    void stats;
    repoReadCacheStats.singleflightLeaders += activeReads === repoReadFileInflight ? 1 : 0;
    repoReadCacheStats.chunkSingleflightLeaders += activeReads === repoReadFileChunkInflight ? 1 : 0;
    const currentReadPromise = loader();
    activeReads.set(key, currentReadPromise);
    try {
        return cloneRepoReadSingleflightResult(await currentReadPromise);
    } catch (error) {
        repoReadCacheStats.singleflightErrors += activeReads === repoReadFileInflight ? 1 : 0;
        repoReadCacheStats.chunkSingleflightErrors += activeReads === repoReadFileChunkInflight ? 1 : 0;
        throw error;
    } finally {
        if (activeReads.get(key) === currentReadPromise) activeReads.delete(key);
    }
}

/**
 * @param {Record<string, unknown>} structured
 * @param {string} text
 * @returns {number}
 */
function estimateRepoReadCacheEntryWeightBytes(structured, text) {
    const textBytes = Buffer.byteLength(String(text ?? ''), 'utf8');
    let structuredBytes;
    try {
        structuredBytes = Buffer.byteLength(JSON.stringify(structured), 'utf8');
    } catch {
        structuredBytes = 1024;
    }
    return Math.max(1, textBytes + structuredBytes);
}

/**
 * @param {Map<string, RepoReadCacheEntry>} cache
 * @returns {number}
 */
function sumRepoReadCacheWeightBytes(cache) {
    let total = 0;
    for (const entry of cache.values()) total += Math.max(0, Number(entry.weightBytes ?? 0));
    return total;
}

/**
 * @param {string} key
 * @param {RepoReadCacheEntry} entry
 * @returns {void}
 */
function rememberRepoReadFileCacheEntry(key, entry) {
    if (repoReadFileResultCache.has(key)) repoReadFileResultCache.delete(key);
    repoReadFileResultCache.set(key, entry);
    repoReadCacheStats.sets += 1;
    trimRepoReadCache(repoReadFileResultCache, 'evictions');
}

/**
 * @param {string} key
 * @param {RepoReadCacheEntry} entry
 * @returns {void}
 */
function rememberRepoReadFileChunkCacheEntry(key, entry) {
    if (repoReadFileChunkCache.has(key)) repoReadFileChunkCache.delete(key);
    repoReadFileChunkCache.set(key, entry);
    repoReadCacheStats.chunkSets += 1;
    trimRepoReadCache(repoReadFileChunkCache, 'chunkEvictions');
}

/**
 * @param {Map<string, RepoReadCacheEntry>} cache
 * @param {'evictions' | 'chunkEvictions'} statName
 */
function trimRepoReadCache(cache, statName) {
    const maxBytes = readRepoReadCacheMaxBytes();
    while (cache.size > REPO_READ_FILE_CACHE_MAX_ENTRIES || sumRepoReadCacheWeightBytes(cache) > maxBytes) {
        const oldest = cache.keys().next().value;
        if (typeof oldest !== 'string') break;
        cache.delete(oldest);
        repoReadCacheStats[statName] += 1;
    }
}

/**
 * @param {Record<string, unknown>} structured
 * @returns {Record<string, unknown>}
 */
function cloneStructuredReadFileResult(structured) {
    return cloneJsonLikeRecord(structured);
}

/**
 * Clone JSON-like MCP result records without serializing large immutable strings.
 *
 * The previous JSON.stringify/parse clone copied full file contents again on every cache hit. A shallow/deep structural
 * clone keeps cached nested arrays/objects isolated while preserving primitive values directly, which is safe because
 * strings, numbers, booleans and null are immutable.
 *
 * @param {Record<string, unknown>} value
 * @returns {Record<string, unknown>}
 */
function cloneJsonLikeRecord(value) {
    const cloned = cloneJsonLikeValue(value);
    return cloned && typeof cloned === 'object' && !Array.isArray(cloned)
        ? /** @type {Record<string, unknown>} */ (cloned)
        : { ...value };
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneJsonLikeValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((entry) => cloneJsonLikeValue(entry));
    const output = /** @type {Record<string, unknown>} */ ({});
    for (const [key, entry] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        if (entry !== undefined) output[key] = cloneJsonLikeValue(entry);
    }
    return output;
}
