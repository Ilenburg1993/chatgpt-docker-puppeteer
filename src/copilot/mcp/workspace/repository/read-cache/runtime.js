// @ts-check
/**
 * MCP repo read response cache.
 *
 * This cache is intentionally above the canonical IO cache: it stores already-shaped MCP tool payloads for repeated
 * `repo_read_file` and `repo_read_file_chunks` calls. The lower IO L1/L2 cache stores full file bytes/text; this module
 * stores resolved windows/chunks plus their text response.
 *
 * @module copilot/mcp/workspace/repository/read-cache/runtime
 */

import path from 'node:path';

const REPO_READ_FILE_CACHE_MAX_ENTRIES = 128;

/**
 * @typedef {{
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 *     validatedAtMs: number;
 *     structured: Record<string, unknown>;
 *     text: string;
 *     weightBytes: number;
 * }} RepoReadCacheEntry
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
    hashVariantMisses: 0,
    fingerprintValidations: 0,
    fingerprintValidationHits: 0,
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

/**
 * Return MCP repo read response-cache stats.
 *
 * @returns {Record<string, number> & {
 *     size: number;
 *     chunkSize: number;
 *     bytes: number;
 *     chunkBytes: number;
 *     maxBytes: number;
 *     trustWindowMs: number;
 * }}
 */
/** @param {import('./config.js').McpRepoReadCacheConfig} config */
export function readRepoReadFileResultCacheStats(config) {
    if (!config) throw new TypeError('Repository read-cache stats require an explicit cache config generation.');
    return {
        ...repoReadCacheStats,
        size: repoReadFileResultCache.size,
        chunkSize: repoReadFileChunkCache.size,
        bytes: sumRepoReadCacheWeightBytes(repoReadFileResultCache),
        chunkBytes: sumRepoReadCacheWeightBytes(repoReadFileChunkCache),
        maxBytes: config.maxBytes,
        trustWindowMs: config.trustWindowMs,
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
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']} workspaceIo
 * @param {{ resolved: string; relative: string; validatedReadPath: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath }} resolved
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 * @param {'full' | 'returned' | 'none'} [hashMode]
 * @returns {Promise<{ structured: Record<string, unknown>; text: string }>}
 */
export async function readRepoFileWithValidatedResultCache(
    workspaceIo,
    resolved,
    startLine,
    endLine,
    config,
    hashMode = 'full',
) {
    if (!config) throw new TypeError('Repository read-cache operation requires an explicit cache config generation.');
    const key = buildRepoReadFileCacheKey(resolved.resolved, startLine, endLine, config);
    const cached = await getValidatedRepoReadCacheEntry(
        workspaceIo,
        repoReadFileResultCache,
        key,
        resolved.validatedReadPath,
        {
            hitStat: 'hits',
            trustWindowHitStat: 'trustWindowHits',
            staleStat: 'stale',
            hashMode,
        },
        config,
    );
    if (cached) return { structured: cloneStructuredReadFileResult(cached.structured), text: cached.text };

    const inflightKey = `${key}\u0000hash:${hashMode}`;
    return runRepoReadSingleflight(
        repoReadFileInflight,
        inflightKey,
        {
            leaderStat: 'singleflightLeaders',
            joinStat: 'singleflightJoins',
            errorStat: 'singleflightErrors',
        },
        async () => {
            repoReadCacheStats.misses += 1;
            const snapshot = await workspaceIo.readTextValidated(resolved.validatedReadPath, {
                ...(startLine !== undefined ? { startLine } : {}),
                ...(endLine !== undefined ? { endLine } : {}),
                hashMode,
            });
            const structured = {
                success: true,
                path: resolved.relative,
                content: snapshot.content,
                ...(typeof snapshot.contentHash === 'string' ? { sha256: snapshot.contentHash } : {}),
                ...(typeof snapshot.returnedContentHash === 'string'
                    ? { returnedSha256: snapshot.returnedContentHash }
                    : {}),
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
                rememberRepoReadFileCacheEntry(
                    key,
                    {
                        sizeBytes,
                        mtimeMs,
                        ctimeMs,
                        dev,
                        ino,
                        validatedAtMs: Date.now(),
                        structured,
                        text: snapshot.content,
                        weightBytes: estimateRepoReadCacheEntryWeightBytes(structured, snapshot.content),
                    },
                    config,
                );
            }
            return { structured, text: snapshot.content };
        },
    );
}

/**
 * Read line chunks and cache the already-shaped MCP payload.
 *
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']} workspaceIo
 * @param {{ resolved: string; relative: string; validatedReadPath: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath }} resolved
 * @param {number} effectiveStartLine
 * @param {number | undefined} endLine
 * @param {number} chunkLines
 * @param {number | undefined} highWaterMark
 * @param {string | undefined} cursor
 * @param {number} maxOutputBytes
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 * @returns {Promise<{ structured: Record<string, unknown>; text: string }>}
 */
export async function readRepoFileChunksWithValidatedResultCache(
    workspaceIo,
    resolved,
    effectiveStartLine,
    endLine,
    chunkLines,
    highWaterMark,
    cursor,
    maxOutputBytes,
    config,
) {
    if (!config) throw new TypeError('Repository read-cache operation requires an explicit cache config generation.');
    const key = buildRepoReadFileChunkCacheKey(
        resolved.resolved,
        effectiveStartLine,
        endLine,
        chunkLines,
        highWaterMark,
        config,
    );
    const cached = await getValidatedRepoReadCacheEntry(
        workspaceIo,
        repoReadFileChunkCache,
        key,
        resolved.validatedReadPath,
        {
            hitStat: 'chunkHits',
            trustWindowHitStat: 'chunkTrustWindowHits',
            staleStat: 'chunkStale',
        },
        config,
    );
    if (cached) return shapeChunkResultForCaller(cached, cursor, maxOutputBytes);

    const canonical = await runRepoReadSingleflight(
        repoReadFileChunkInflight,
        key,
        {
            leaderStat: 'chunkSingleflightLeaders',
            joinStat: 'chunkSingleflightJoins',
            errorStat: 'chunkSingleflightErrors',
        },
        async () => {
            repoReadCacheStats.chunkMisses += 1;
            const snapshot = await workspaceIo.readTextChunksValidated(resolved.validatedReadPath, {
                startLine: effectiveStartLine,
                ...(endLine !== undefined ? { endLine } : {}),
                chunkLines,
                ...(highWaterMark !== undefined ? { highWaterMark } : {}),
            });
            const lastChunk = snapshot.chunks[snapshot.chunks.length - 1];
            const lastReturnedLine = lastChunk?.endLine ?? effectiveStartLine - 1;
            const hasMoreLines =
                snapshot.stoppedAtRequestedWindow === true ||
                (snapshot.totalLinesKnown === true && lastReturnedLine < snapshot.totalLines);
            const nextCursor = hasMoreLines ? String(lastReturnedLine + 1) : null;
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
                ...('indexBytesRead' in snapshot ? { indexBytesRead: snapshot.indexBytesRead } : {}),
                ...('rangeBytesRead' in snapshot ? { rangeBytesRead: snapshot.rangeBytesRead } : {}),
                ...('indexCacheState' in snapshot ? { indexCacheState: snapshot.indexCacheState } : {}),
                ...('rangeSource' in snapshot ? { rangeSource: snapshot.rangeSource } : {}),
                nextCursor,
                engine: snapshot.io.engine,
            };
            const sizeBytes = Number(snapshot.sizeBytes ?? snapshot.bytesRead);
            const mtimeMs = Number(snapshot.mtimeMs);
            const ctimeMs = Number(snapshot.ctimeMs);
            const dev = Number(snapshot.dev);
            const ino = Number(snapshot.ino);
            if ([sizeBytes, mtimeMs, ctimeMs, dev, ino].every(Number.isFinite)) {
                rememberRepoReadFileChunkCacheEntry(
                    key,
                    {
                        sizeBytes,
                        mtimeMs,
                        ctimeMs,
                        dev,
                        ino,
                        validatedAtMs: Date.now(),
                        structured,
                        text,
                        weightBytes: estimateRepoReadCacheEntryWeightBytes(structured, text),
                    },
                    config,
                );
            }
            return { structured, text };
        },
    );
    return shapeChunkResultForCaller(canonical, cursor, maxOutputBytes);
}

/**
 * Apply caller-specific page presentation after cache/singleflight resolution. The canonical cache keeps the complete
 * line-bounded page so callers with different byte budgets can share one physical read safely.
 *
 * @param {RepoReadCacheResult} result
 * @param {string | undefined} cursor
 * @param {number} maxOutputBytes
 * @returns {RepoReadCacheResult}
 */
function shapeChunkResultForCaller(result, cursor, maxOutputBytes) {
    const structured = cloneStructuredReadFileResult(result.structured);
    const chunks = Array.isArray(structured['chunks'])
        ? /** @type {Record<string, unknown>[]} */ (structured['chunks'])
        : [];
    /** @type {Record<string, unknown>[]} */
    const selected = [];
    let contentBytes = 0;
    let stoppedAtOutputBudget = false;
    for (const chunk of chunks) {
        const chunkBytes = Number.isFinite(chunk['bytes'])
            ? Math.max(0, Number(chunk['bytes']))
            : Buffer.byteLength(String(chunk['content'] ?? ''), 'utf8');
        const contribution = chunkBytes + (selected.length > 0 ? 1 : 0);
        if (contentBytes + contribution > maxOutputBytes) {
            if (selected.length === 0) {
                const error = Object.assign(
                    new Error(
                        `First chunk requires ${String(contribution)} UTF-8 bytes but maxOutputBytes is ${String(maxOutputBytes)}.`,
                    ),
                    {
                        code: 'ERR_CHUNK_PAGE_ITEM_TOO_LARGE',
                        requiredBytes: contribution,
                        maxOutputBytes,
                        startLine: Number(chunk['startLine'] ?? 0),
                        endLine: Number(chunk['endLine'] ?? 0),
                    },
                );
                throw error;
            }
            stoppedAtOutputBudget = true;
            break;
        }
        selected.push(chunk);
        contentBytes += contribution;
    }
    const returnedLineCount = selected.reduce(
        (sum, chunk) => sum + Math.max(0, Number(chunk['endLine'] ?? 0) - Number(chunk['startLine'] ?? 0) + 1),
        0,
    );
    const lastSelected = selected[selected.length - 1];
    if (stoppedAtOutputBudget && lastSelected) {
        structured['nextCursor'] = String(Number(lastSelected['endLine'] ?? 0) + 1);
    }
    const nextCursor = typeof structured['nextCursor'] === 'string' ? structured['nextCursor'] : null;
    structured['chunks'] = selected;
    structured['chunkCount'] = selected.length;
    structured['returnedChunkCount'] = selected.length;
    structured['returnedLineCount'] = returnedLineCount;
    structured['returnedContentBytes'] = contentBytes;
    structured['contentBudgetBytes'] = maxOutputBytes;
    structured['stoppedAtOutputBudget'] = stoppedAtOutputBudget;
    structured['cursor'] = cursor ?? null;
    structured['truncated'] = nextCursor !== null;
    structured['hasMore'] = nextCursor !== null;
    const text = selected.map((chunk) => String(chunk['content'] ?? '')).join('\n');
    return { structured, text };
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
}

/**
 * Apply an externally-owned workspace invalidation to the response cache. This function owns no subscription; the
 * caller that owns the invalidation bus also owns registration and teardown.
 *
 * @param {string} filePath
 * @param {{ recursive?: boolean }} event
 * @returns {number}
 */
export function invalidateRepoReadResponseCache(filePath, event = {}) {
    const removed = event.recursive
        ? clearRepoReadFileResultCacheForResolvedSubtree(filePath)
        : clearRepoReadFileResultCacheForResolvedPath(filePath);
    repoReadCacheStats.busInvalidations += 1;
    if (event.recursive) repoReadCacheStats.recursiveInvalidations += 1;
    return removed;
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
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability['io']} workspaceIo
 * @param {Map<string, RepoReadCacheEntry>} cache
 * @param {string} key
 * @param {import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath} validatedReadPath
 * @param {{
 *     hitStat: 'hits' | 'chunkHits';
 *     trustWindowHitStat: 'trustWindowHits' | 'chunkTrustWindowHits';
 *     staleStat: 'stale' | 'chunkStale';
 *     hashMode?: 'full' | 'returned' | 'none';
 * }} stats
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 * @returns {Promise<RepoReadCacheEntry | null>}
 */
async function getValidatedRepoReadCacheEntry(workspaceIo, cache, key, validatedReadPath, stats, config) {
    const cached = cache.get(key);
    if (!cached) return null;
    if (stats.hashMode && !repoReadCacheEntrySupportsHashMode(cached, stats.hashMode)) {
        repoReadCacheStats.hashVariantMisses += 1;
        return null;
    }
    const trustWindowMs = config.trustWindowMs;
    if (trustWindowMs > 0 && Date.now() - cached.validatedAtMs <= trustWindowMs) {
        repoReadCacheStats[stats.hitStat] += 1;
        repoReadCacheStats[stats.trustWindowHitStat] += 1;
        cache.delete(key);
        // LRU touch sem renovar validatedAtMs: a trust window é fixa e não pode ser estendida por tráfego contínuo.
        cache.set(key, cached);
        return cached;
    }
    repoReadCacheStats.fingerprintValidations += 1;
    const current = await workspaceIo.statPathValidated(validatedReadPath).catch(() => null);
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
        repoReadCacheStats.fingerprintValidationHits += 1;
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
/**
 * @param {string} absolutePath
 * @param {number | undefined} startLine
 * @param {number | undefined} endLine
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 */
function buildRepoReadFileCacheKey(absolutePath, startLine, endLine, config) {
    return `${absolutePath}\u0000policy:${config.policyKey}\u0000${startLine ?? ''}\u0000${endLine ?? ''}`;
}

/** @param {RepoReadCacheEntry} cached @param {'full' | 'returned' | 'none'} hashMode */
function repoReadCacheEntrySupportsHashMode(cached, hashMode) {
    if (hashMode === 'none') return true;
    const hasReturnedHash = typeof cached.structured['returnedSha256'] === 'string';
    if (hashMode === 'returned') return hasReturnedHash;
    return hasReturnedHash && typeof cached.structured['sha256'] === 'string';
}

/**
 * @param {string} absolutePath
 * @param {number} startLine
 * @param {number | undefined} endLine
 * @param {number} chunkLines
 * @param {number | undefined} highWaterMark
 * @returns {string}
 */
/**
 * @param {string} absolutePath
 * @param {number} startLine
 * @param {number | undefined} endLine
 * @param {number} chunkLines
 * @param {number | undefined} highWaterMark
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 */
function buildRepoReadFileChunkCacheKey(absolutePath, startLine, endLine, chunkLines, highWaterMark, config) {
    return `${absolutePath}\u0000policy:${config.policyKey}\u0000chunks\u0000${startLine}\u0000${endLine ?? ''}\u0000${chunkLines}\u0000${highWaterMark ?? ''}`;
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
 * @param {Record<
 *     string,
 *     | 'singleflightLeaders'
 *     | 'singleflightJoins'
 *     | 'singleflightErrors'
 *     | 'chunkSingleflightLeaders'
 *     | 'chunkSingleflightJoins'
 *     | 'chunkSingleflightErrors'
 * >} stats
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
/**
 * @param {string} key
 * @param {RepoReadCacheEntry} entry
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 */
function rememberRepoReadFileCacheEntry(key, entry, config) {
    if (repoReadFileResultCache.has(key)) repoReadFileResultCache.delete(key);
    repoReadFileResultCache.set(key, entry);
    repoReadCacheStats.sets += 1;
    trimRepoReadCache(repoReadFileResultCache, 'evictions', config);
}

/**
 * @param {string} key
 * @param {RepoReadCacheEntry} entry
 * @returns {void}
 */
/**
 * @param {string} key
 * @param {RepoReadCacheEntry} entry
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 */
function rememberRepoReadFileChunkCacheEntry(key, entry, config) {
    if (repoReadFileChunkCache.has(key)) repoReadFileChunkCache.delete(key);
    repoReadFileChunkCache.set(key, entry);
    repoReadCacheStats.chunkSets += 1;
    trimRepoReadCache(repoReadFileChunkCache, 'chunkEvictions', config);
}

/**
 * @param {Map<string, RepoReadCacheEntry>} cache
 * @param {'evictions' | 'chunkEvictions'} statName
 */
/**
 * @param {Map<string, RepoReadCacheEntry>} cache
 * @param {'evictions' | 'chunkEvictions'} statName
 * @param {import('./config.js').McpRepoReadCacheConfig} config
 */
function trimRepoReadCache(cache, statName, config) {
    const maxBytes = config.maxBytes;
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
