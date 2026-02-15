import { connect, Index } from '@lancedb/lancedb';
import { Schema, Field, Utf8, Int32, Int64, Float32, FixedSizeList, List, Bool } from 'apache-arrow';
import { rerank } from '../retrieve/reranker.mjs';
import { maximalMarginalRelevance } from '../retrieve/diversity.mjs';
import { withTimeout } from '../../../../src/infra/abort_controller_utils.js';

export const TABLE_NAME = 'chunks_v2';

export async function openDb(dbDir) {
    return connect(dbDir);
}

export function buildSchema(embeddingDim) {
    return new Schema([
        new Field('chunk_id', new Utf8(), false),
        new Field('file_id', new Utf8(), false),
        new Field('path', new Utf8(), false),
        new Field('ext', new Utf8(), false),
        new Field('language', new Utf8(), true),
        new Field('kind', new Utf8(), true),
        new Field('symbol', new Utf8(), true),
        new Field('exported', new Bool(), false),
        new Field('start_line', new Int32(), false),
        new Field('end_line', new Int32(), false),
        new Field('start_byte', new Int32(), false),
        new Field('end_byte', new Int32(), false),
        new Field('tags', new List(new Field('item', new Utf8(), true)), true),
        new Field('header_text', new Utf8(), true),
        new Field('text', new Utf8(), false),
        new Field('embed_text', new Utf8(), false),
        new Field('chunk_prev_id', new Utf8(), true),
        new Field('chunk_next_id', new Utf8(), true),
        new Field('content_sha256', new Utf8(), false),
        new Field('embedding_model', new Utf8(), false),
        new Field('vector', new FixedSizeList(embeddingDim, new Field('item', new Float32(), true)), false),
        new Field('indexed_at', new Int64(), false)
    ]);
}

export async function ensureTable(db, embeddingDim) {
    return await withTimeout(
        async () => {
            const tables = await db.tableNames();
            if (tables.includes(TABLE_NAME)) {
                return db.openTable(TABLE_NAME);
            }
            const schema = buildSchema(embeddingDim);
            await db.createEmptyTable(TABLE_NAME, schema);
            return db.openTable(TABLE_NAME);
        },
        15000,
        'LANCEDB_ENSURE_TABLE_TIMEOUT'
    );
}

export async function createFTSIndex(table) {
    console.log('[RAG] Creating FTS index on "embed_text" column...');
    try {
        await table.createIndex('embed_text', { config: Index.fts() });
        console.log('[RAG] ✓ FTS index created successfully');
    } catch (err) {
        if (err?.message && (err.message.includes('already exists') || err.message.includes('Index already exists'))) {
            console.log('[RAG] FTS index already exists, skipping');
        } else {
            console.error('[RAG] Failed to create FTS index:', err?.message || err);
            throw err;
        }
    }
}

export async function deleteByPath(table, relPath) {
    return await withTimeout(
        async () => {
            const safe = relPath.replace(/'/g, "''");
            await table.delete(`path = '${safe}'`);
        },
        30000,
        'LANCEDB_DELETE_BY_PATH_TIMEOUT'
    );
}

export async function addChunks(table, rows, { batchSize = 32 } = {}) {
    return await withTimeout(
        async () => {
            let total = 0;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                if (batch.length === 0) continue;
                await table.add(batch);
                total += batch.length;
            }
            return total;
        },
        60000,
        'LANCEDB_ADD_CHUNKS_TIMEOUT'
    );
}

export async function getChunkById(table, chunkId) {
    return await withTimeout(
        async () => {
            const safe = String(chunkId || '').replace(/'/g, "''");
            const rows = await table
                .query()
                .where(`chunk_id = '${safe}'`)
                .limit(1)
                .toArray();
            if (!rows.length) return null;
            return formatResult(rows[0]);
        },
        15000,
        'LANCEDB_GET_CHUNK_BY_ID_TIMEOUT'
    );
}

export async function getChunkStats(table) {
    return await withTimeout(
        async () => {
            let chunkCount = null;
            const counters = ['countRows', 'count_rows', 'count'];
            for (const fn of counters) {
                if (typeof table?.[fn] === 'function') {
                    try {
                        const value = await table[fn]();
                        if (typeof value === 'number' && Number.isFinite(value)) {
                            chunkCount = value;
                            break;
                        }
                    } catch {
                        // ignore unsupported counters
                    }
                }
            }

            const sample = await table.query().limit(1).toArray();
            const sampleRow = sample[0] || null;
            return {
                chunk_count: chunkCount,
                has_rows: Boolean(sampleRow),
                sample_has_v2_fields: sampleRow
                    ? ['kind', 'symbol', 'header_text', 'embed_text', 'chunk_prev_id', 'chunk_next_id'].every((k) => Object.prototype.hasOwnProperty.call(sampleRow, k))
                    : null
            };
        },
        15000,
        'LANCEDB_CHUNK_STATS_TIMEOUT'
    );
}

/**
 * @param {{ pathPrefix?: string, ext?: string, tags?: string[] }} [filters]
 */
function buildWhere({ pathPrefix, ext, tags } = {}) {
    const parts = [];
    if (pathPrefix) {
        const safe = pathPrefix.replace(/'/g, "''");
        parts.push(`path LIKE '${safe}%'`);
    }
    if (ext) {
        const safe = String(ext).replace(/'/g, "''");
        parts.push(`ext = '${safe}'`);
    }
    if (tags && tags.length > 0) {
        // tag filtering is performed client-side for compatibility.
    }
    return parts.length ? parts.join(' AND ') : null;
}

/**
 * @param {any} table
 * @param {number[]} vector
 * @param {{ topK?: number, filters?: { pathPrefix?: string, ext?: string, tags?: string[] }, distanceRange?: [number, number] | { min?: number, max?: number } }} [options]
 */
export async function search(table, vector, { topK = 8, filters = {}, distanceRange } = {}) {
    return await withTimeout(
        async () => {
            const where = buildWhere(filters);
            let q = table.search(vector);

            if (distanceRange) {
                const [min, max] = Array.isArray(distanceRange)
                    ? distanceRange
                    : [distanceRange.min || 0, distanceRange.max || 1];
                q = q.distanceRange(min, max);
            }

            q = q.limit(topK * 5);
            if (where) q = q.where(where);
            const rows = await q.toArray();

            let filtered = rows;
            if (filters?.tags?.length) {
                const required = new Set(filters.tags.map(String));
                filtered = rows.filter((r) => Array.isArray(r.tags) && [...required].every((t) => r.tags.includes(t)));
            }

            filtered.sort((a, b) => {
                const da = typeof a._distance === 'number' ? a._distance : 0;
                const db = typeof b._distance === 'number' ? b._distance : 0;
                if (da !== db) return da - db;
                if (a.path !== b.path) return String(a.path).localeCompare(String(b.path));
                if (a.start_line !== b.start_line) return (a.start_line || 0) - (b.start_line || 0);
                return String(a.chunk_id).localeCompare(String(b.chunk_id));
            });

            return filtered.slice(0, topK).map(formatResult);
        },
        45000,
        'LANCEDB_SEARCH_TIMEOUT'
    );
}

export async function hybridSearch(table, vector, textQuery, options = {}) {
    return await withTimeout(
        async () => {
            const {
                topK = 8,
                filters = {},
                distanceRange,
                rerank: shouldRerank = true,
                rerankWeights,
                mmr: shouldMMR = true,
                mmrLambda = 0.7
            } = options;

            let q = table
                .query()
                .fullTextSearch(textQuery)
                .nearestTo(vector);

            if (distanceRange) {
                const [min, max] = Array.isArray(distanceRange)
                    ? distanceRange
                    : [distanceRange.min || 0, distanceRange.max || 1];
                q = q.distanceRange(min, max);
            }

            const fetchLimit = shouldRerank ? topK * 2 : topK * 5;
            q = q.limit(fetchLimit);

            const where = buildWhere(filters);
            if (where) q = q.where(where);

            const rows = await q.toArray();

            let filtered = rows;
            if (filters?.tags?.length) {
                const required = new Set(filters.tags.map(String));
                filtered = rows.filter((r) => Array.isArray(r.tags) && [...required].every((t) => r.tags.includes(t)));
            }

            filtered.sort((a, b) => {
                const da = typeof a._distance === 'number' ? a._distance : 0;
                const db = typeof b._distance === 'number' ? b._distance : 0;
                if (da !== db) return da - db;
                if (a.path !== b.path) return String(a.path).localeCompare(String(b.path));
                if (a.start_line !== b.start_line) return (a.start_line || 0) - (b.start_line || 0);
                return String(a.chunk_id).localeCompare(String(b.chunk_id));
            });

            let results = filtered.map(formatResult);

            if (shouldRerank && results.length > 0) {
                console.log(`[RAG] Reranking ${results.length} results with 6 signals...`);
                results = rerank(results, textQuery, { weights: rerankWeights });
            }

            if (shouldMMR && results.length > topK) {
                console.log(`[RAG] Applying MMR for diversity (lambda=${mmrLambda})...`);
                results = maximalMarginalRelevance(results, {
                    lambda: mmrLambda,
                    topK
                });
            } else {
                results = results.slice(0, topK);
            }

            return results;
        },
        60000,
        'LANCEDB_HYBRID_SEARCH_TIMEOUT'
    );
}

export async function lexicalSearch(table, textQuery, options = {}) {
    return await withTimeout(
        async () => {
            const { topK = 8, filters = {} } = options;

            let q = table
                .query()
                .fullTextSearch(textQuery)
                .limit(topK * 5);

            const where = buildWhere(filters);
            if (where) q = q.where(where);

            const rows = await q.toArray();

            let filtered = rows;
            if (filters?.tags?.length) {
                const required = new Set(filters.tags.map(String));
                filtered = rows.filter((r) =>
                    Array.isArray(r.tags) && [...required].every((t) => r.tags.includes(t))
                );
            }

            filtered.sort((a, b) => {
                const sa = typeof a._score === 'number' ? a._score : 0;
                const sb = typeof b._score === 'number' ? b._score : 0;
                if (sa !== sb) return sb - sa;
                if (a.path !== b.path) return String(a.path).localeCompare(String(b.path));
                if (a.start_line !== b.start_line) return (a.start_line || 0) - (b.start_line || 0);
                return String(a.chunk_id).localeCompare(String(b.chunk_id));
            });

            return filtered.slice(0, topK).map((row) => ({
                ...formatResult(row),
                score: typeof row._score === 'number' ? row._score : 0
            }));
        },
        45000,
        'LANCEDB_LEXICAL_SEARCH_TIMEOUT'
    );
}

function formatResult(row) {
    const indexedAtMs = normalizeIndexedAtMs(row.indexed_at);
    return {
        score: typeof row._distance === 'number' ? -row._distance : 0,
        distance: row._distance,
        chunk_id: row.chunk_id,
        file_id: row.file_id,
        path: row.path,
        ext: row.ext,
        language: row.language ?? undefined,
        kind: row.kind ?? undefined,
        symbol: row.symbol ?? undefined,
        exported: Boolean(row.exported),
        start_line: row.start_line,
        end_line: row.end_line,
        start_byte: row.start_byte,
        end_byte: row.end_byte,
        tags: row.tags || [],
        header_text: row.header_text ?? undefined,
        text: row.text,
        embed_text: row.embed_text,
        chunk_prev_id: row.chunk_prev_id ?? null,
        chunk_next_id: row.chunk_next_id ?? null,
        content_sha256: row.content_sha256,
        embedding_model: row.embedding_model,
        indexed_at: indexedAtMs,
        indexed_at_iso: indexedAtMs ? toIsoSecond(indexedAtMs) : null,
        indexed_at_local: indexedAtMs ? toLocalSecond(indexedAtMs) : null
    };
}

function normalizeIndexedAtMs(value) {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
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
