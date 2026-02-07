import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getRagPaths, ensureDirs, atomicWriteJson, acquireIndexLock, releaseIndexLock } from './paths.mjs';
import { createEmptyManifest, loadManifest } from './manifest.mjs';
import { scanWorkspace, findProjectRoot } from './scan.mjs';
import { fingerprintBuffer } from './fingerprint.mjs';
import { buildLineIndex, sliceByLines } from './text.mjs';
import { buildChunkId, buildFileId, sha256HexForString, normalizeRelPath, CHUNKER_VERSION } from './contract.mjs';
import { chunkByType, detectLanguage, buildTags } from './chunking/chunk_dispatcher.mjs';
import { OllamaEmbeddingsProvider } from './embeddings/ollama.mjs';
import { EmbeddingCache } from './embeddings/embed_cache.mjs';
import { AdaptiveThrottler } from './adaptive_throttler.mjs';
import { openDb, ensureTable, deleteByPath, addChunks, search, hybridSearch } from './storage/lancedb.mjs';
import { formatMarkdownResults } from './format.mjs';
import { normalizeQuery } from './text/query_normalizer.mjs';

// Singleton query embedding cache
const queryEmbedCache = new EmbeddingCache(100);

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

export async function ragHealth(options = {}) {
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
        ollama: embHealth,
        lancedb: { ok: !('error' in db), tableNames }
    };
}

export async function ragIndex(options = {}) {
    const root = options.root ? path.resolve(options.root) : await findProjectRoot(process.cwd());
    const paths = getRagPaths(options.paths);
    await ensureDirs(paths);

    const lock = await acquireIndexLock(paths);
    if (!lock.acquired) {
        const lockInfo = lock.existingLock || {};
        const err = new Error(
            `RAG_INDEX_LOCKED: Another indexing process is running.\n` +
            `Lock held by PID ${lockInfo.pid || 'unknown'} since ${lockInfo.started_at ? new Date(lockInfo.started_at).toISOString() : 'unknown'}\n\n` +
            `If no indexing is running, the lock may be stale.\n` +
            `It will auto-clear after 6 hours, or you can manually remove:\n` +
            `  rm /home/node/.local/share/rag-index/index.lock\n`
        );
        err.details = lock;
        throw err;
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

        const files = await scanWorkspace(root, { maxFileBytes: options.maxFileBytes });

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
            const ranges = chunkByType({ relPath, lines });
            const ext = computeExt(relPath);
            const language = detectLanguage(relPath);
            const tags = buildTags(relPath);
            const file_id = buildFileId(relPath);

            const chunkRows = [];
            for (const r of ranges) {
                const { startByte, endByte, text } = sliceByLines(f.buffer, lineStarts, r.startLine, r.endLine);
                const content_sha256 = sha256HexForString(text);
                const chunk_id = buildChunkId({
                    relPath,
                    startByte,
                    endByte,
                    contentSha256: content_sha256,
                    chunkerVersion: manifest.chunker_version
                });

                // Embed with retry logic (handles transient failures)
                console.log(`[RAG]   → Embedding chunk ${report.embedded_chunks + 1}/${ranges.length}: ${text.length} chars (lines ${r.startLine}-${r.endLine})`);
                const vector = await retryWithBackoff(
                    () => embeddings.embed(text),
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
                    chunk_id,
                    file_id,
                    path: relPath,
                    ext,
                    language: language ?? null,
                    start_line: r.startLine,
                    end_line: r.endLine,
                    start_byte: startByte,
                    end_byte: endByte,
                    tags,
                    text,
                    content_sha256,
                    embedding_model: embeddings.model,
                    vector,
                    indexed_at: BigInt(Date.now())
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
                indexed_at: Date.now()
            };
        }

        console.log(`[RAG] Indexing complete: ${report.inserted_chunks} chunks indexed`);

        manifest.updated_at = Date.now();

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
}

export async function ragQuery(options = {}) {
    const paths = getRagPaths(options.paths);
    await ensureDirs(paths);
    const manifest = (await loadManifest(paths)) || createEmptyManifest();
    const embeddings = options.embeddingsProvider || new OllamaEmbeddingsProvider({
        baseURL: options.ollamaBaseUrl || manifest.embedding.base_url_default,
        model: options.model || manifest.embedding.model
    });

    // Normalize query for better cache hits (same query variations → same cache key)
    const normalizedQuery = normalizeQuery(options.query);

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
        // Use original query for embedding (not normalized, to preserve semantic nuances)
        vector = await embeddings.embed(options.query);
        if (!options.embeddingsProvider) {
            // But store with normalized key for better cache reuse
            queryEmbedCache.set(normalizedQuery, embeddings.model, vector);
        }
    }

    if (manifest.embedding.dim && vector.length !== manifest.embedding.dim) {
        throw new Error(`EMBEDDING_DIM_MISMATCH expected=${manifest.embedding.dim} got=${vector.length}`);
    }

    const db = await openDb(paths.dbDir);
    let dbClosed = false;

    try {
        const table = await ensureTable(db, manifest.embedding.dim || vector.length);

        const results = await search(table, vector, {
            topK: options.topK ?? 8,
            filters: options.filters || {}
        });

        return {
            query: options.query,
            embedding_model: embeddings.model,
            topK: options.topK ?? 8,
            filters: options.filters || {},
            results
        };
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
}

/**
 * Hybrid search (vector + FTS + reranking + MMR) with formatted output
 * Combines semantic vector search with lexical full-text search,
 * multi-signal reranking, and MMR diversity algorithm
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
    const paths = getRagPaths(options.paths);
    await ensureDirs(paths);
    const manifest = (await loadManifest(paths)) || createEmptyManifest();

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

    // Normalize query for better cache hits (same query variations → same cache key)
    const normalizedQuery = normalizeQuery(query);

    // Try cache first (only for real queries, skip if embeddingsProvider injected = test)
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
        // Use original query for embedding (not normalized, to preserve semantic nuances)
        vector = await embeddings.embed(query);
        if (!options.embeddingsProvider) {
            // But store with normalized key for better cache reuse
            queryEmbedCache.set(normalizedQuery, embeddings.model, vector);
        }
    }

    if (manifest.embedding.dim && vector.length !== manifest.embedding.dim) {
        throw new Error(`EMBEDDING_DIM_MISMATCH expected=${manifest.embedding.dim} got=${vector.length}`);
    }

    const db = await openDb(paths.dbDir);
    let dbClosed = false;

    try {
        const table = await ensureTable(db, manifest.embedding.dim || vector.length);

        console.log(`[RAG] Hybrid search: query="${query}", topK=${topK}, rerank=${rerank}, mmr=${mmr}`);

        const results = await hybridSearch(table, vector, query, {
            topK,
            filters: { pathPrefix, ext, tags },
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
            hybridMode: true,
            rerank,
            mmr,
            mmrLambda
        };
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
