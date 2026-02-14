import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getRagPaths, ensureDirs, atomicWriteJson, acquireIndexLock, releaseIndexLock } from './paths.mjs';
import { createEmptyManifest, loadManifest } from './manifest.mjs';
import { scanWorkspace, findProjectRoot, RAG_SCAN_PROFILES, loadWorkspaceFile } from './scan.mjs';
import { fingerprintBuffer } from './fingerprint.mjs';
import { buildLineIndex, sliceByLines } from './text.mjs';
import {
    buildChunkId,
    buildFileId,
    sha256HexForString,
    normalizeRelPath,
    CHUNKER_VERSION,
    RAG_CHUNK_MAX_CHARS
} from './contract.mjs';
import { chunkByType, detectLanguage, buildTags } from './chunking/chunk_dispatcher.mjs';
import { OllamaEmbeddingsProvider } from './embeddings/ollama.mjs';
import { EmbeddingCache } from './embeddings/embed_cache.mjs';
import { AdaptiveThrottler } from './adaptive_throttler.mjs';
import {
    openDb,
    ensureTable,
    deleteByPath,
    addChunks,
    search,
    hybridSearch,
    lexicalSearch,
    createFTSIndex,
    getChunkById,
    getChunkStats,
    TABLE_NAME
} from './storage/lancedb.mjs';
import { formatMarkdownResults } from './format.mjs';
import { normalizeQuery } from './text/query_normalizer.mjs';
import { withTimeout } from '../../../src/infra/abort_controller_utils.js';

// Singleton query embedding cache
const queryEmbedCache = new EmbeddingCache(100);

const RAG_REASON_CODES = Object.freeze({
    OLLAMA_UNAVAILABLE: 'OLLAMA_UNAVAILABLE',
    EMBEDDING_TIMEOUT: 'EMBEDDING_TIMEOUT',
    INDEX_LOCKED: 'INDEX_LOCKED',
    RAG_QUERY_TIMEOUT: 'RAG_QUERY_TIMEOUT'
});

const RAG_INDEX_MODE = Object.freeze({
    FULL: 'full',
    INCREMENTAL: 'incremental'
});

function resolveDefaultProfile(requestedProfile) {
    const raw = String(requestedProfile || process.env.RAG_PROFILE_DEFAULT || 'core').trim();
    return Object.prototype.hasOwnProperty.call(RAG_SCAN_PROFILES, raw) ? raw : 'core';
}

function isDegradedEnabled(explicitValue) {
    if (typeof explicitValue === 'boolean') return explicitValue;
    return String(process.env.RAG_DEGRADED_MODE_ENABLED || 'true') !== 'false';
}

function classifyRagReasonCode(error) {
    const message = String(error?.message || '').toUpperCase();
    if (message.includes('RAG_INDEX_LOCKED')) return RAG_REASON_CODES.INDEX_LOCKED;
    if (message.includes('RAG_QUERY_TIMEOUT') || message.includes('RAG_HYBRID_SEARCH_TIMEOUT')) {
        return RAG_REASON_CODES.RAG_QUERY_TIMEOUT;
    }
    if (message.includes('EMBED') && message.includes('TIMEOUT')) return RAG_REASON_CODES.EMBEDDING_TIMEOUT;
    return RAG_REASON_CODES.OLLAMA_UNAVAILABLE;
}

function shouldDegrade(error) {
    const reasonCode = classifyRagReasonCode(error);
    return reasonCode === RAG_REASON_CODES.OLLAMA_UNAVAILABLE || reasonCode === RAG_REASON_CODES.EMBEDDING_TIMEOUT;
}

function normalizeTimestampMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function toIsoSecond(epochMs) {
    const iso = new Date(epochMs).toISOString();
    return iso.replace(/\.\d{3}Z$/, 'Z');
}

function toLocalSecond(epochMs) {
    const d = new Date(epochMs);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildTimeFields(epochMs) {
    const normalized = normalizeTimestampMs(epochMs);
    if (!normalized) {
        return {
            indexed_at: null,
            indexed_at_iso: null,
            indexed_at_local: null
        };
    }
    return {
        indexed_at: normalized,
        indexed_at_iso: toIsoSecond(normalized),
        indexed_at_local: toLocalSecond(normalized)
    };
}

function buildIndexStatus(manifest, nowMs = Date.now()) {
    const updatedAtMs = normalizeTimestampMs(manifest?.updated_at);
    const mode = manifest?.last_index_mode === RAG_INDEX_MODE.INCREMENTAL
        ? RAG_INDEX_MODE.INCREMENTAL
        : RAG_INDEX_MODE.FULL;
    return {
        index_mode: mode,
        index_updated_at: updatedAtMs,
        index_updated_at_iso: updatedAtMs ? toIsoSecond(updatedAtMs) : null,
        index_updated_at_local: updatedAtMs ? toLocalSecond(updatedAtMs) : null,
        index_freshness_ms: updatedAtMs ? Math.max(0, nowMs - updatedAtMs) : null
    };
}

function buildQueryStatus(nowMs = Date.now()) {
    return {
        query_at: nowMs,
        query_at_iso: toIsoSecond(nowMs),
        query_at_local: toLocalSecond(nowMs)
    };
}

function buildIndexLockError(lock) {
    const lockInfo = lock?.existingLock || {};
    const err = new Error(
        `RAG_INDEX_LOCKED: Another indexing process is running.\n` +
        `Lock held by PID ${lockInfo.pid || 'unknown'} since ${lockInfo.started_at ? new Date(lockInfo.started_at).toISOString() : 'unknown'}\n\n` +
        `If no indexing is running, the lock may be stale.\n` +
        `It will auto-clear after 6 hours, or you can manually remove:\n` +
        `  rm /home/node/.local/share/rag-index/index.lock\n`
    );
    err.details = lock;
    err.reason_code = RAG_REASON_CODES.INDEX_LOCKED;
    return err;
}

function buildHeaderTextForRange(range, { relPath, language, tags }) {
    if (typeof range?.headerText === 'string' && range.headerText.trim()) {
        return range.headerText;
    }
    const lines = [];
    lines.push(`path: ${relPath}`);
    lines.push(`language: ${language || 'unknown'}`);
    lines.push(`kind: ${range?.kind || 'module_fallback'}`);
    if (range?.symbol) lines.push(`symbol: ${range.symbol}`);
    lines.push(`exported: ${range?.exported ? 'true' : 'false'}`);
    if (Array.isArray(tags) && tags.length) lines.push(`tags: ${tags.join(', ')}`);
    return lines.join('\n');
}

function buildEmbedText(headerText, text) {
    if (!headerText) return text;
    return `${headerText}\n\n${text}`;
}

function toChunkDescriptor(range, { relPath, lineStarts, fileBuffer, manifestChunkerVersion, language, tags }) {
    const { startByte, endByte, text } = sliceByLines(fileBuffer, lineStarts, range.startLine, range.endLine);
    const content_sha256 = sha256HexForString(text);
    const chunk_id = buildChunkId({
        relPath,
        startByte,
        endByte,
        contentSha256: content_sha256,
        chunkerVersion: manifestChunkerVersion
    });
    const header_text = buildHeaderTextForRange(range, { relPath, language, tags });
    const embed_text = buildEmbedText(header_text, text);

    return {
        chunk_id,
        kind: range?.kind || 'module_fallback',
        symbol: range?.symbol || null,
        exported: Boolean(range?.exported),
        startLine: range.startLine,
        endLine: range.endLine,
        startByte,
        endByte,
        text,
        header_text,
        embed_text,
        content_sha256
    };
}

function withNeighborIds(descriptors) {
    return descriptors.map((d, idx) => ({
        ...d,
        chunk_prev_id: idx > 0 ? descriptors[idx - 1].chunk_id : null,
        chunk_next_id: idx + 1 < descriptors.length ? descriptors[idx + 1].chunk_id : null
    }));
}

function parsePositiveIntWithDefault(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getExpandConfig() {
    const fallbackDefaultLines = 40;
    const fallbackMaxLines = 240;
    const maxLines = parsePositiveIntWithDefault(process.env.RAG_EXPAND_MAX_LINES, fallbackMaxLines);
    const defaultLines = Math.min(
        parsePositiveIntWithDefault(process.env.RAG_EXPAND_DEFAULT_LINES, fallbackDefaultLines),
        maxLines
    );
    return { defaultLines, maxLines };
}

function clampExpandLines(raw, fallback, maxLines) {
    const parsed = parsePositiveIntWithDefault(raw, fallback);
    return Math.min(parsed, maxLines);
}

function buildStructuredExpandError(reasonCode, message, details = {}) {
    return {
        ok: false,
        reason_code: reasonCode,
        message,
        ...details
    };
}

/**
 * Retry wrapper for embedding operations
 * Applies exponential backoff to any embedding provider
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result from fn
 */
async function retryWithBackoff(fn, options = {}) {
    const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000, onRetry } = options;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
                if (onRetry) {
                    onRetry(error, attempt + 1, maxRetries, delay);
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

/**
 * ✅ P1-1: Wrapped with timeout (30s) to prevent hanging on slow operations
 */
export async function ragHealth(options = {}) {
    return await withTimeout(
        async () => {
            const paths = getRagPaths(options.paths);
            await ensureDirs(paths);

            const writable = await canWrite(paths.indexDir) && await canWrite(paths.dbDir);
            const manifest = await loadManifest(paths).catch(err => ({ error: String(err?.message || err) }));

            const embeddings = options.embeddingsProvider || new OllamaEmbeddingsProvider({
                baseURL: options.ollamaBaseUrl,
                model: options.model
            });
            const embHealth = await embeddings.health().catch(err => ({ ok: false, error: String(err?.message || err) }));

            const db = await openDb(paths.dbDir).catch(err => ({ error: String(err?.message || err) }));
            let tableNames = null;
            if (!('error' in db)) {
                tableNames = await db.tableNames().catch(() => null);
                try {
                    await db.close();
                } catch (_) {
                    // ignore
                }
            }

            const ok =
                writable &&
                !(manifest && manifest.error) &&
                embHealth.ok &&
                embHealth.hasModel &&
                !('error' in db);

            return {
                ok,
                paths,
                writable,
                manifest_ok: !(manifest && manifest.error),
                manifest,
                ...buildIndexStatus(manifest),
                ollama: embHealth,
                lancedb: { ok: !('error' in db), tableNames }
            };
        },
        30000,
        'RAG_HEALTH_TIMEOUT'
    );
}

/**
 * ✅ P1-1: Wrapped with timeout (30 minutes) to prevent infinite indexing
 */
export async function ragIndex(options = {}) {
    return await withTimeout(
        async () => {
            const root = options.root ? path.resolve(options.root) : await findProjectRoot(process.cwd());
            const paths = getRagPaths(options.paths);
            await ensureDirs(paths);

        const lock = await acquireIndexLock(paths);
        if (!lock.acquired) {
            throw buildIndexLockError(lock);
        }

            try {
        let manifest = await loadManifest(paths);
        if (!manifest) {
            manifest = createEmptyManifest();
            manifest.embedding.model = options.model || manifest.embedding.model;
            manifest.embedding.base_url_default = options.ollamaBaseUrl || manifest.embedding.base_url_default;
        }

        if (manifest.chunker_version !== CHUNKER_VERSION) {
            throw new Error(
                `CHUNKER_VERSION_MISMATCH: Index uses chunker '${manifest.chunker_version}', ` +
                `but code expects '${CHUNKER_VERSION}'.\n\n` +
                `This happens when the RAG chunking logic changes.\n` +
                `Solution: Reset and rebuild the index:\n` +
                `  npm run rag:reset -- --yes\n` +
                `  npm run rag:index\n`
            );
        }

        const embeddings = options.embeddingsProvider || new OllamaEmbeddingsProvider({
            baseURL: options.ollamaBaseUrl || manifest.embedding.base_url_default,
            model: options.model || manifest.embedding.model
        });

        const resolvedProfile = resolveDefaultProfile(options.profile);
        const files = await scanWorkspace(root, {
            profile: resolvedProfile,
            includeGlobs: options.includeGlobs,
            excludeGlobs: options.excludeGlobs,
            maxFileBytes: options.maxFileBytes
        });

        // Validate embedding dimension early (fail-fast if model changed)
        if (manifest.embedding.dim !== null && files.length > 0) {
            console.log('[RAG] Validating embedding dimension...');
            const testVector = await embeddings.embed('test');
            const actualDim = testVector.length;

            if (manifest.embedding.dim !== actualDim) {
                throw new Error(
                    `EMBEDDING_DIM_MISMATCH: Manifest expects dim=${manifest.embedding.dim}, ` +
                    `but model '${embeddings.model}' returned dim=${actualDim}.\n` +
                    `Solution: Run 'npm run rag:reset -- --yes' then 'npm run rag:index'`
                );
            }
            console.log(`[RAG] Dimension validated: ${actualDim}`);
        }

        const db = await openDb(paths.dbDir);

        // Adaptive throttler to prevent CPU overload
        const throttler = new AdaptiveThrottler({
            targetCPU: 40,      // Target 40% CPU (safe for most systems)
            minDelay: 100,      // Min 100ms between embeddings
            maxDelay: 5000,     // Max 5s (if CPU very high)
            initialDelay: 500,  // Start conservative
            enabled: true       // Enable adaptive throttling
        });

        const report = {
            root,
            scanned_files: files.length,
            changed_files: 0,
            skipped_files: 0,
            embedded_chunks: 0,
            inserted_chunks: 0,
            deleted_chunks: 0
        };

        // Lazily ensure table after we have embedding dim
        let table = null;

        console.log(`[RAG] Indexing: ${files.length} files scanned, processing changes...`);

        let processedCount = 0;
        let changedCount = 0;

        for (const f of files) {
            processedCount++;
            const relPath = normalizeRelPath(f.relPath);
            const fp = await fingerprintBuffer(f.buffer);
            const prev = manifest.files[relPath];

            if (prev && prev.sha256 === fp.sha256 && prev.xxhash64 === fp.xxhash64 && prev.size === f.size) {
                report.skipped_files++;

                // Progress report every 25 files OR at the end
                if (processedCount % 25 === 0 || processedCount === files.length) {
                    console.log(
                        `[RAG] Progress: ${processedCount}/${files.length} scanned ` +
                        `(${report.changed_files} changed, ${report.skipped_files} skipped, ` +
                        `${report.embedded_chunks} chunks embedded)`
                    );
                }
                continue;
            }

            report.changed_files++;
            changedCount++;

            // Log file being processed (only changed files, to avoid clutter)
            console.log(`[RAG] Processing [${changedCount}]: ${relPath}`);

            const { lines, lineStarts } = buildLineIndex(f.buffer);
            const ranges = chunkByType({
                relPath,
                lines,
                maxChunkChars: Math.min(RAG_CHUNK_MAX_CHARS, Number(options.maxChunkChars || RAG_CHUNK_MAX_CHARS))
            });
            const ext = computeExt(relPath);
            const language = detectLanguage(relPath);
            const tags = buildTags(relPath);
            const file_id = buildFileId(relPath);
            const indexedAtMs = Date.now();

            const descriptors = withNeighborIds(ranges.map((r) => toChunkDescriptor(r, {
                relPath,
                lineStarts,
                fileBuffer: f.buffer,
                manifestChunkerVersion: manifest.chunker_version,
                language,
                tags
            })));

            const chunkRows = [];
            for (const descriptor of descriptors) {
                // Embed with retry logic (handles transient failures)
                console.log(
                    `[RAG]   → Embedding chunk ${report.embedded_chunks + 1}/${descriptors.length}: ` +
                    `${descriptor.embed_text.length} chars (lines ${descriptor.startLine}-${descriptor.endLine})`
                );
                const vector = await retryWithBackoff(
                    () => embeddings.embed(descriptor.embed_text),
                    {
                        maxRetries: 3,
                        initialDelay: 1000,
                        maxDelay: 10000,
                        onRetry: (err, attempt, max, delay) => {
                            console.warn(`[RAG] Embed retry ${attempt}/${max} after ${delay}ms: ${err.message}`);
                        }
                    }
                );
                report.embedded_chunks++;

                // Adaptive throttling: automatically adjusts delay based on CPU usage
                // Speeds up when CPU < 30%, slows down when CPU > 50%
                await throttler.throttle();

                if (!manifest.embedding.dim) {
                    manifest.embedding.dim = vector.length;
                } else if (manifest.embedding.dim !== vector.length) {
                    throw new Error(`EMBEDDING_DIM_MISMATCH expected=${manifest.embedding.dim} got=${vector.length}`);
                }

                if (!table) {
                    table = await ensureTable(db, manifest.embedding.dim);
                }

                chunkRows.push({
                    chunk_id: descriptor.chunk_id,
                    file_id,
                    path: relPath,
                    ext,
                    language: language ?? null,
                    kind: descriptor.kind,
                    symbol: descriptor.symbol,
                    exported: descriptor.exported,
                    start_line: descriptor.startLine,
                    end_line: descriptor.endLine,
                    start_byte: descriptor.startByte,
                    end_byte: descriptor.endByte,
                    tags,
                    header_text: descriptor.header_text,
                    text: descriptor.text,
                    embed_text: descriptor.embed_text,
                    chunk_prev_id: descriptor.chunk_prev_id,
                    chunk_next_id: descriptor.chunk_next_id,
                    content_sha256: descriptor.content_sha256,
                    embedding_model: embeddings.model,
                    vector,
                    indexed_at: BigInt(indexedAtMs)
                });
            }

            if (table) {
            await deleteByPath(table, relPath);
            report.deleted_chunks += 1; // logical delete op (not row count)
            report.inserted_chunks += await addChunks(table, chunkRows);
            }

            manifest.files[relPath] = {
                size: f.size,
                mtime_ms: f.mtimeMs,
                xxhash64: fp.xxhash64,
                sha256: fp.sha256,
                ...buildTimeFields(indexedAtMs)
            };
        }

        if (table) {
            try {
                await createFTSIndex(table);
            } catch (ftsError) {
                console.warn(`[RAG] FTS index not available yet: ${ftsError?.message || ftsError}`);
            }
        }

        console.log(`[RAG] Indexing complete: ${report.inserted_chunks} chunks indexed`);

        manifest.updated_at = Date.now();
        manifest.last_index_mode = RAG_INDEX_MODE.FULL;

        // Display indexing summary
        console.log('\n[RAG] ═══ Indexing Summary ═══');
        console.log(`  Files scanned:    ${report.scanned_files}`);
        console.log(`  Files changed:    ${report.changed_files}`);
        console.log(`  Files skipped:    ${report.skipped_files} (${((report.skipped_files/report.scanned_files)*100).toFixed(1)}%)`);
        console.log(`  Chunks embedded:  ${report.embedded_chunks}`);
        console.log(`  Chunks inserted:  ${report.inserted_chunks}`);
        if (report.changed_files > 0) {
            console.log(`  Avg chunks/file:  ${(report.embedded_chunks/report.changed_files).toFixed(1)}`);
        }
        console.log('═══════════════════════════════\n');

        await atomicWriteJson(paths.manifestPath, manifest);
        try {
            await db.close();
        } catch (_) {
            // ignore
        }

                return report;
            } finally {
                await releaseIndexLock(paths);
            }
        },
        1800000, // 30 minutes
        'RAG_INDEX_TIMEOUT'
    );
}

/**
 * Selective incremental indexing for changed/deleted paths.
 * Indexes only the provided file paths and preserves manifest/storage contracts.
 */
export async function ragIndexChanged(options = {}) {
    return await withTimeout(
        async () => {
            const root = options.root ? path.resolve(options.root) : await findProjectRoot(process.cwd());
            const storeOverrides =
                options.ragPaths ||
                (options.paths && typeof options.paths === 'object' && !Array.isArray(options.paths)
                    ? options.paths
                    : undefined);
            const paths = getRagPaths(storeOverrides);
            await ensureDirs(paths);

            const lock = await acquireIndexLock(paths);
            if (!lock.acquired) {
                throw buildIndexLockError(lock);
            }

            try {
                let manifest = await loadManifest(paths);
                if (!manifest) {
                    manifest = createEmptyManifest();
                    manifest.embedding.model = options.model || manifest.embedding.model;
                    manifest.embedding.base_url_default = options.ollamaBaseUrl || manifest.embedding.base_url_default;
                }

                if (manifest.chunker_version !== CHUNKER_VERSION) {
                    throw new Error(
                        `CHUNKER_VERSION_MISMATCH: Index uses chunker '${manifest.chunker_version}', ` +
                        `but code expects '${CHUNKER_VERSION}'.\n\n` +
                        `This happens when the RAG chunking logic changes.\n` +
                        `Solution: Reset and rebuild the index:\n` +
                        `  npm run rag:reset -- --yes\n` +
                        `  npm run rag:index\n`
                    );
                }

                const embeddings = options.embeddingsProvider || new OllamaEmbeddingsProvider({
                    baseURL: options.ollamaBaseUrl || manifest.embedding.base_url_default,
                    model: options.model || manifest.embedding.model
                });

                const resolvedProfile = resolveDefaultProfile(options.profile);
                const changedPaths = [...new Set(
                    (
                        Array.isArray(options.changedPaths)
                            ? options.changedPaths
                            : Array.isArray(options.paths)
                                ? options.paths
                                : []
                    )
                        .map((p) => normalizeRelPath(String(p || '').replace(/\\/g, '/')))
                        .filter(Boolean)
                )];

                const report = {
                    root,
                    profile: resolvedProfile,
                    requested_paths: changedPaths.length,
                    processed_paths: 0,
                    changed_files: 0,
                    deleted_files: 0,
                    skipped_files: 0,
                    embedded_chunks: 0,
                    inserted_chunks: 0,
                    deleted_chunks: 0
                };

                if (changedPaths.length === 0) {
                    return report;
                }

                const db = await openDb(paths.dbDir);
                const tableNames = await db.tableNames().catch(() => []);
                let table = tableNames.includes(TABLE_NAME) ? await db.openTable(TABLE_NAME) : null;
                let dimValidated = manifest.embedding.dim === null;

                const throttler = new AdaptiveThrottler({
                    targetCPU: 40,
                    minDelay: 100,
                    maxDelay: 5000,
                    initialDelay: 250,
                    enabled: true
                });

                for (const relPath of changedPaths) {
                    report.processed_paths++;
                    const prev = manifest.files[relPath];

                    const file = await loadWorkspaceFile(root, relPath, {
                        profile: resolvedProfile,
                        includeGlobs: options.includeGlobs,
                        excludeGlobs: options.excludeGlobs,
                        maxFileBytes: options.maxFileBytes
                    });

                    // Deleted or now excluded file: remove from index + manifest.
                    if (!file) {
                        if (prev) {
                            if (table) {
                                await deleteByPath(table, relPath);
                                report.deleted_chunks += 1;
                            }
                            delete manifest.files[relPath];
                            report.deleted_files++;
                        } else {
                            report.skipped_files++;
                        }
                        continue;
                    }

                    const fp = await fingerprintBuffer(file.buffer);
                    if (prev && prev.sha256 === fp.sha256 && prev.xxhash64 === fp.xxhash64 && prev.size === file.size) {
                        report.skipped_files++;
                        continue;
                    }

                    if (!dimValidated && manifest.embedding.dim !== null) {
                        const testVector = await embeddings.embed('test');
                        const actualDim = testVector.length;
                        if (manifest.embedding.dim !== actualDim) {
                            throw new Error(
                                `EMBEDDING_DIM_MISMATCH: Manifest expects dim=${manifest.embedding.dim}, ` +
                                `but model '${embeddings.model}' returned dim=${actualDim}.\n` +
                                `Solution: Run 'npm run rag:reset -- --yes' then 'npm run rag:index'`
                            );
                        }
                        dimValidated = true;
                    }

                    report.changed_files++;

                    const { lines, lineStarts } = buildLineIndex(file.buffer);
                    const ranges = chunkByType({
                        relPath,
                        lines,
                        maxChunkChars: Math.min(RAG_CHUNK_MAX_CHARS, Number(options.maxChunkChars || RAG_CHUNK_MAX_CHARS))
                    });
                    const ext = computeExt(relPath);
                    const language = detectLanguage(relPath);
                    const tags = buildTags(relPath);
                    const file_id = buildFileId(relPath);
                    const indexedAtMs = Date.now();

                    const descriptors = withNeighborIds(ranges.map((r) => toChunkDescriptor(r, {
                        relPath,
                        lineStarts,
                        fileBuffer: file.buffer,
                        manifestChunkerVersion: manifest.chunker_version,
                        language,
                        tags
                    })));

                    const chunkRows = [];
                    for (const descriptor of descriptors) {
                        const vector = await retryWithBackoff(
                            () => embeddings.embed(descriptor.embed_text),
                            {
                                maxRetries: 3,
                                initialDelay: 1000,
                                maxDelay: 10000
                            }
                        );
                        report.embedded_chunks++;
                        await throttler.throttle();

                        if (!manifest.embedding.dim) {
                            manifest.embedding.dim = vector.length;
                        } else if (manifest.embedding.dim !== vector.length) {
                            throw new Error(`EMBEDDING_DIM_MISMATCH expected=${manifest.embedding.dim} got=${vector.length}`);
                        }

                        if (!table) {
                            table = await ensureTable(db, manifest.embedding.dim);
                        }

                        chunkRows.push({
                            chunk_id: descriptor.chunk_id,
                            file_id,
                            path: relPath,
                            ext,
                            language: language ?? null,
                            kind: descriptor.kind,
                            symbol: descriptor.symbol,
                            exported: descriptor.exported,
                            start_line: descriptor.startLine,
                            end_line: descriptor.endLine,
                            start_byte: descriptor.startByte,
                            end_byte: descriptor.endByte,
                            tags,
                            header_text: descriptor.header_text,
                            text: descriptor.text,
                            embed_text: descriptor.embed_text,
                            chunk_prev_id: descriptor.chunk_prev_id,
                            chunk_next_id: descriptor.chunk_next_id,
                            content_sha256: descriptor.content_sha256,
                            embedding_model: embeddings.model,
                            vector,
                            indexed_at: BigInt(indexedAtMs)
                        });
                    }

                    if (table) {
                        await deleteByPath(table, relPath);
                        report.deleted_chunks += 1;
                        report.inserted_chunks += await addChunks(table, chunkRows);
                    }

                    manifest.files[relPath] = {
                        size: file.size,
                        mtime_ms: file.mtimeMs,
                        xxhash64: fp.xxhash64,
                        sha256: fp.sha256,
                        ...buildTimeFields(indexedAtMs)
                    };
                }

                if (table) {
                    try {
                        await createFTSIndex(table);
                    } catch (ftsError) {
                        console.warn(`[RAG] FTS index not available yet: ${ftsError?.message || ftsError}`);
                    }
                }

                manifest.updated_at = Date.now();
                manifest.last_index_mode = RAG_INDEX_MODE.INCREMENTAL;
                await atomicWriteJson(paths.manifestPath, manifest);

                try {
                    await db.close();
                } catch (_) {
                    // ignore
                }

                return report;
            } finally {
                await releaseIndexLock(paths);
            }
        },
        900000,
        'RAG_INDEX_CHANGED_TIMEOUT'
    );
}

/**
 * ✅ P1-1: Wrapped with timeout (60s) to prevent hanging on slow queries
 */
export async function ragQuery(options = {}) {
    return await withTimeout(
        async () => {
            const paths = getRagPaths(options.paths);
            await ensureDirs(paths);
            const manifest = (await loadManifest(paths)) || createEmptyManifest();
            const profile = resolveDefaultProfile(options.profile);
            const mode = String(options.mode || 'auto');
            const degradedModeEnabled = isDegradedEnabled(options.degradedModeEnabled);
            const indexStatus = buildIndexStatus(manifest);
            const topK = options.topK ?? 8;
            const filters = options.filters || {};
            const query = String(options.query || '');

            const embeddings = options.embeddingsProvider || new OllamaEmbeddingsProvider({
                baseURL: options.ollamaBaseUrl || manifest.embedding.base_url_default,
                model: options.model || manifest.embedding.model
            });

            const db = await openDb(paths.dbDir);
            let dbClosed = false;

            try {
                const tableNames = await db.tableNames();

                const lexicalOnly = async (reasonCode, degradedReason) => {
                    if (!tableNames.includes(TABLE_NAME)) {
                        return {
                            query,
                            embedding_model: embeddings.model,
                            topK,
                            filters,
                            profile,
                            ...indexStatus,
                            ...buildQueryStatus(),
                            backend: 'lexical',
                            degraded: Boolean(reasonCode),
                            ...(reasonCode ? { reason_code: reasonCode } : {}),
                            ...(degradedReason ? { degraded_reason: degradedReason } : {}),
                            results: []
                        };
                    }

                    let results = [];
                    try {
                        const table = await db.openTable(TABLE_NAME);
                        results = await lexicalSearch(table, query, { topK, filters });
                    } catch (lexicalError) {
                        console.warn(`[RAG] Lexical fallback failed: ${lexicalError?.message || lexicalError}`);
                    }
                    return {
                        query,
                        embedding_model: embeddings.model,
                        topK,
                        filters,
                        profile,
                        ...indexStatus,
                        ...buildQueryStatus(),
                        backend: 'lexical',
                        degraded: Boolean(reasonCode),
                        ...(reasonCode ? { reason_code: reasonCode } : {}),
                        ...(degradedReason ? { degraded_reason: degradedReason } : {}),
                        results
                    };
                };

                if (mode === 'lexical-only') {
                    return lexicalOnly(undefined, undefined);
                }

                try {
                    // Normalize query for better cache hits (same query variations → same cache key)
                    const normalizedQuery = normalizeQuery(query);

                    // Try cache first (only for real queries, skip if embeddingsProvider injected = test)
                    let vector;
                    if (!options.embeddingsProvider) {
                        vector = queryEmbedCache.get(normalizedQuery, embeddings.model);
                        if (vector) {
                            console.log('[RAG] Query embedding: cache hit');
                        }
                    }

                    if (!vector) {
                        if (!options.embeddingsProvider) {
                            console.log('[RAG] Query embedding: cache miss, generating...');
                        }
                        vector = await embeddings.embed(query);
                        if (!options.embeddingsProvider) {
                            queryEmbedCache.set(normalizedQuery, embeddings.model, vector);
                        }
                    }

                    if (manifest.embedding.dim && vector.length !== manifest.embedding.dim) {
                        throw new Error(`EMBEDDING_DIM_MISMATCH expected=${manifest.embedding.dim} got=${vector.length}`);
                    }

                    const table = await ensureTable(db, manifest.embedding.dim || vector.length);
                    const results = await search(table, vector, {
                        topK,
                        filters
                    });

                    return {
                        query,
                        embedding_model: embeddings.model,
                        topK,
                        filters,
                        profile,
                        ...indexStatus,
                        ...buildQueryStatus(),
                        backend: 'hybrid',
                        degraded: false,
                        results
                    };
                } catch (error) {
                    const reasonCode = classifyRagReasonCode(error);
                    if (mode === 'auto' && degradedModeEnabled && shouldDegrade(error)) {
                        return lexicalOnly(reasonCode, String(error?.message || 'Embedding backend unavailable'));
                    }
                    error.reason_code = reasonCode;
                    throw error;
                }
            } finally {
                // Always close database connection, even on error (prevents resource leak)
                if (!dbClosed) {
                    try {
                        await db.close();
                        dbClosed = true;
                    } catch (_) {
                        // ignore close errors
                    }
                }
            }
        },
        60000, // 60 seconds
        'RAG_QUERY_TIMEOUT'
    );
}

/**
 * Hybrid search (vector + FTS + reranking + MMR) with formatted output
 * Combines semantic vector search with lexical full-text search,
 * multi-signal reranking, and MMR diversity algorithm
 *
 * ✅ P1-1: Wrapped with timeout (90s) to prevent hanging on slow hybrid searches
 *
 * @param {object} options - Search options
 * @param {string} options.query - Query text
 * @param {number} [options.topK] - Number of results (default: 8)
 * @param {string} [options.pathPrefix] - Filter by path prefix
 * @param {string} [options.ext] - Filter by file extension
 * @param {string[]} [options.tags] - Filter by tags
 * @param {object|array} [options.distanceRange] - Min/max distance range
 * @param {boolean} [options.rerank] - Enable reranking (default: true)
 * @param {object} [options.rerankWeights] - Custom rerank weights
 * @param {boolean} [options.mmr] - Enable MMR diversity (default: true)
 * @param {number} [options.mmrLambda] - MMR lambda (default: 0.7)
 * @returns {Promise<object>} - Search results + metadata
 */
export async function ragHybridSearch(options = {}) {
    return await withTimeout(
        async () => {
            const paths = getRagPaths(options.paths);
            await ensureDirs(paths);
            const manifest = (await loadManifest(paths)) || createEmptyManifest();
            const profile = resolveDefaultProfile(options.profile);
            const mode = String(options.mode || 'auto');
            const degradedModeEnabled = isDegradedEnabled(options.degradedModeEnabled);
            const indexStatus = buildIndexStatus(manifest);

            const embeddings = options.embeddingsProvider || new OllamaEmbeddingsProvider({
                baseURL: options.ollamaBaseUrl || manifest.embedding.base_url_default,
                model: options.model || manifest.embedding.model
            });

            const {
                query,
                topK = 8,
                pathPrefix,
                ext,
                tags,
                distanceRange,
                rerank = true,         // Enable reranking by default
                rerankWeights,         // Custom weights (optional)
                mmr = true,            // Enable MMR by default
                mmrLambda = 0.7        // MMR lambda (0.7 = 70% relevance, 30% diversity)
            } = options;

            const db = await openDb(paths.dbDir);
            let dbClosed = false;

            try {
                const filters = { pathPrefix, ext, tags };
                const tableNames = await db.tableNames();

                const runLexical = async (reasonCode, degradedReason) => {
                    if (!tableNames.includes(TABLE_NAME)) {
                        return {
                            results: [],
                            topK,
                            dim: manifest.embedding.dim,
                            model: manifest.embedding.model || embeddings.model,
                            query,
                            profile,
                            ...indexStatus,
                            ...buildQueryStatus(),
                            backend: 'lexical',
                            degraded: Boolean(reasonCode),
                            ...(reasonCode ? { reason_code: reasonCode } : {}),
                            ...(degradedReason ? { degraded_reason: degradedReason } : {}),
                            hybridMode: false,
                            rerank,
                            mmr,
                            mmrLambda
                        };
                    }
                    let results = [];
                    try {
                        const table = await db.openTable(TABLE_NAME);
                        results = await lexicalSearch(table, query, { topK, filters });
                    } catch (lexicalError) {
                        console.warn(`[RAG] Lexical fallback failed: ${lexicalError?.message || lexicalError}`);
                    }
                    return {
                        results,
                        topK,
                        dim: manifest.embedding.dim,
                        model: manifest.embedding.model || embeddings.model,
                        query,
                        profile,
                        ...indexStatus,
                        ...buildQueryStatus(),
                        backend: 'lexical',
                        degraded: Boolean(reasonCode),
                        ...(reasonCode ? { reason_code: reasonCode } : {}),
                        ...(degradedReason ? { degraded_reason: degradedReason } : {}),
                        hybridMode: false,
                        rerank,
                        mmr,
                        mmrLambda
                    };
                };

                if (mode === 'lexical-only') {
                    return runLexical(undefined, undefined);
                }

                try {
                    const normalizedQuery = normalizeQuery(query);
                    let vector;
                    if (!options.embeddingsProvider) {
                        vector = queryEmbedCache.get(normalizedQuery, embeddings.model);
                        if (vector) {
                            console.log('[RAG] Query embedding: cache hit ✅');
                        }
                    }

                    if (!vector) {
                        if (!options.embeddingsProvider) {
                            console.log('[RAG] Query embedding: cache miss, generating...');
                        }
                        vector = await embeddings.embed(query);
                        if (!options.embeddingsProvider) {
                            queryEmbedCache.set(normalizedQuery, embeddings.model, vector);
                        }
                    }

                    if (manifest.embedding.dim && vector.length !== manifest.embedding.dim) {
                        throw new Error(`EMBEDDING_DIM_MISMATCH expected=${manifest.embedding.dim} got=${vector.length}`);
                    }

                    const table = await ensureTable(db, manifest.embedding.dim || vector.length);
                    console.log(`[RAG] Hybrid search: query="${query}", topK=${topK}, rerank=${rerank}, mmr=${mmr}`);
                    const results = await hybridSearch(table, vector, query, {
                        topK,
                        filters,
                        distanceRange,
                        rerank,
                        rerankWeights,
                        mmr,
                        mmrLambda
                    });

                    return {
                        results,
                        topK,
                        dim: manifest.embedding.dim,
                        model: manifest.embedding.model || embeddings.model,
                        query,
                        profile,
                        ...indexStatus,
                        ...buildQueryStatus(),
                        backend: 'hybrid',
                        degraded: false,
                        hybridMode: true,
                        rerank,
                        mmr,
                        mmrLambda
                    };
                } catch (error) {
                    const reasonCode = classifyRagReasonCode(error);
                    if (mode === 'auto' && degradedModeEnabled && shouldDegrade(error)) {
                        return runLexical(reasonCode, String(error?.message || 'Embedding backend unavailable'));
                    }
                    error.reason_code = reasonCode;
                    throw error;
                }
            } finally {
                // Always close database connection, even on error (prevents resource leak)
                if (!dbClosed) {
                    try {
                        await db.close();
                        dbClosed = true;
                    } catch (_) {
                        // ignore close errors
                    }
                }
            }
        },
        90000, // 90 seconds (hybrid search is more expensive)
        'RAG_HYBRID_SEARCH_TIMEOUT'
    );
}

export async function ragAsk(options = {}) {
    const result = await ragQuery(options);
    const markdown = formatMarkdownResults(result);
    return { markdown, result };
}

export async function ragReset(options = {}) {
    const paths = getRagPaths(options.paths);
    if (!options.yes) {
        throw new Error(
            'RAG_RESET_REQUIRES_YES: This operation will delete all indexed data.\n' +
            'To confirm, run: npm run rag:reset -- --yes'
        );
    }
    await ensureDirs(paths);
    await rmContents(paths.dbDir);
    await rmContents(paths.indexDir);
}

/**
 * Get query embedding cache statistics
 * Useful for monitoring cache performance and hit rates
 * @returns {object} - Cache stats { size, maxSize, hits, misses, hitRate }
 *
 * @example
 * const stats = getRagCacheStats();
 * console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
 * console.log(`Cache size: ${stats.size}/${stats.maxSize}`);
 */
export function getRagCacheStats() {
    return queryEmbedCache.getStats();
}

export async function ragExpand(options = {}) {
    const paths = getRagPaths(options.paths);
    await ensureDirs(paths);

    const chunkId = String(options.chunkId || options.chunk_id || '').trim();
    if (!chunkId) {
        return buildStructuredExpandError('INVALID_CHUNK_ID', 'chunk_id is required');
    }

    const root = options.root ? path.resolve(options.root) : await findProjectRoot(process.cwd());
    const mode = String(options.mode || 'lines').trim().toLowerCase();
    if (mode !== 'lines' && mode !== 'symbol') {
        return buildStructuredExpandError(
            'INVALID_EXPAND_MODE',
            'mode must be one of: lines, symbol',
            { mode }
        );
    }

    const manifest = (await loadManifest(paths)) || createEmptyManifest();
    const { defaultLines, maxLines } = getExpandConfig();
    const beforeLines = clampExpandLines(options.beforeLines, defaultLines, maxLines);
    const afterLines = clampExpandLines(options.afterLines, defaultLines, maxLines);

    const db = await openDb(paths.dbDir);
    let dbClosed = false;
    try {
        const tableNames = await db.tableNames().catch(() => []);
        if (!tableNames.includes(TABLE_NAME)) {
            return buildStructuredExpandError(
                'INDEX_NOT_FOUND',
                'RAG index table not found. Rebuild index before calling rag_expand.',
                {
                    chunk_id: chunkId,
                    ...buildIndexStatus(manifest)
                }
            );
        }

        const table = await db.openTable(TABLE_NAME);
        const chunk = await getChunkById(table, chunkId);
        if (!chunk) {
            return buildStructuredExpandError('CHUNK_NOT_FOUND', 'chunk_id not found in index', {
                chunk_id: chunkId,
                ...buildIndexStatus(manifest)
            });
        }

        const filePath = path.join(root, chunk.path);
        const fileBuffer = await fs.readFile(filePath);
        const { lines, lineStarts } = buildLineIndex(fileBuffer);
        const maxLine = Math.max(1, lines.length);

        let baseStartLine = chunk.start_line;
        let baseEndLine = chunk.end_line;
        let expansionBasis = 'chunk';

        if (mode === 'symbol' && chunk.symbol) {
            const safePath = String(chunk.path).replace(/'/g, "''");
            const rows = await table
                .query()
                .where(`path = '${safePath}'`)
                .limit(10000)
                .toArray();
            const sameSymbol = rows.filter((row) => String(row.symbol || '') === String(chunk.symbol));
            if (sameSymbol.length > 0) {
                baseStartLine = sameSymbol.reduce((min, row) => Math.min(min, Number(row.start_line || min)), baseStartLine);
                baseEndLine = sameSymbol.reduce((max, row) => Math.max(max, Number(row.end_line || max)), baseEndLine);
                expansionBasis = 'symbol';
            }
        }

        const expandedStartLine = Math.max(1, baseStartLine - beforeLines);
        const expandedEndLine = Math.min(maxLine, baseEndLine + afterLines);
        const expandedSlice = sliceByLines(fileBuffer, lineStarts, expandedStartLine, expandedEndLine);

        const nowMs = Date.now();
        return {
            ok: true,
            chunk_id: chunk.chunk_id,
            mode,
            expansion_basis: expansionBasis,
            path: chunk.path,
            language: chunk.language || detectLanguage(chunk.path) || null,
            kind: chunk.kind || null,
            symbol: chunk.symbol || null,
            exported: Boolean(chunk.exported),
            header_text: chunk.header_text || null,
            chunk_prev_id: chunk.chunk_prev_id || null,
            chunk_next_id: chunk.chunk_next_id || null,
            base_range: {
                start_line: baseStartLine,
                end_line: baseEndLine
            },
            range: {
                start_line: expandedStartLine,
                end_line: expandedEndLine
            },
            requested_before_lines: beforeLines,
            requested_after_lines: afterLines,
            indexed_at: chunk.indexed_at || null,
            indexed_at_iso: chunk.indexed_at_iso || null,
            indexed_at_local: chunk.indexed_at_local || null,
            query_at: nowMs,
            query_at_iso: toIsoSecond(nowMs),
            query_at_local: toLocalSecond(nowMs),
            ...buildIndexStatus(manifest, nowMs),
            text: expandedSlice.text
        };
    } catch (error) {
        return buildStructuredExpandError('RAG_EXPAND_FAILED', String(error?.message || error), {
            chunk_id: chunkId,
            mode
        });
    } finally {
        if (!dbClosed) {
            try {
                await db.close();
                dbClosed = true;
            } catch {
                // ignore
            }
        }
    }
}

export async function getRagStorageStats(options = {}) {
    const paths = getRagPaths(options.paths);
    await ensureDirs(paths);
    const manifest = (await loadManifest(paths)) || createEmptyManifest();
    const db = await openDb(paths.dbDir);
    let dbClosed = false;

    try {
        const tableNames = await db.tableNames().catch(() => []);
        if (!tableNames.includes(TABLE_NAME)) {
            return {
                table_name: TABLE_NAME,
                table_exists: false,
                chunker_version: manifest.chunker_version,
                expected_chunker_version: CHUNKER_VERSION,
                chunker_mismatch: manifest.chunker_version !== CHUNKER_VERSION,
                ...buildIndexStatus(manifest)
            };
        }

        const table = await db.openTable(TABLE_NAME);
        const chunkStats = await getChunkStats(table);
        return {
            table_name: TABLE_NAME,
            table_exists: true,
            chunker_version: manifest.chunker_version,
            expected_chunker_version: CHUNKER_VERSION,
            chunker_mismatch: manifest.chunker_version !== CHUNKER_VERSION,
            ...buildIndexStatus(manifest),
            ...chunkStats
        };
    } finally {
        if (!dbClosed) {
            try {
                await db.close();
                dbClosed = true;
            } catch {
                // ignore
            }
        }
    }
}

export async function getRagIndexStatus(options = {}) {
    const paths = getRagPaths(options.paths);
    await ensureDirs(paths);
    const manifest = (await loadManifest(paths)) || createEmptyManifest();
    return buildIndexStatus(manifest);
}

async function canWrite(dirPath) {
    try {
        const testFile = path.join(dirPath, `.write_test_${process.pid}_${Date.now()}`);
        await fs.writeFile(testFile, 'ok', 'utf8');
        await fs.unlink(testFile);
        return true;
    } catch (_) {
        return false;
    }
}

function computeExt(relPath) {
    const base = path.posix.basename(relPath);
    if (base === 'Dockerfile' || base.toLowerCase().endsWith('.dockerfile')) return '.dockerfile';
    if (base === 'Makefile') return 'Makefile';
    if (base.endsWith('.env.example')) return '.env.example';
    const ext = path.posix.extname(base).toLowerCase();
    return ext || base;
}

async function rmContents(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
        const full = path.join(dirPath, ent.name);
        await fs.rm(full, { recursive: true, force: true }).catch(() => {});
    }
}
