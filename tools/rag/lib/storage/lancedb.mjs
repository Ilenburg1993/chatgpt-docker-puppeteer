// @ts-check
import { connect, Index } from '@lancedb/lancedb';
import { Bool, Field, FixedSizeList, Float32, Int32, Int64, List, Schema, Utf8 } from 'apache-arrow';
import { withTimeout } from '../../../../src/infra/abort_controller_utils.js';
import { normalizeContentClass } from '../content_class.mjs';
import { maximalMarginalRelevance } from '../retrieve/diversity.mjs';
import { rerank } from '../retrieve/reranker.mjs';

export const TABLE_NAME = 'chunks_v2';

export async function openDb(/** @type {any} */ dbDir) {
    return connect(dbDir);
}

export function buildSchema(/** @type {any} */ embeddingDim) {
    return new Schema([
        new Field('chunk_id', new Utf8(), false),
        new Field('file_id', new Utf8(), false),
        new Field('path', new Utf8(), false),
        new Field('ext', new Utf8(), false),
        new Field('content_class', new Utf8(), true),
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
        new Field('indexed_at', new Int64(), false),
    ]);
}

export async function ensureTable(/** @type {any} */ db, /** @type {any} */ embeddingDim) {
    return await withTimeout(
        /** @type {any} */ async () => {
            const tables = await db.tableNames();
            if (tables.includes(TABLE_NAME)) {
                return db.openTable(TABLE_NAME);
            }
            const schema = buildSchema(embeddingDim);
            await db.createEmptyTable(TABLE_NAME, schema);
            return db.openTable(TABLE_NAME);
        },
        15000,
        'LANCEDB_ENSURE_TABLE_TIMEOUT',
    );
}

export async function createFTSIndex(/** @type {any} */ table) {
    console.log('[RAG] Creating FTS index on "embed_text" column...');
    try {
        await table.createIndex('embed_text', { config: Index.fts() });
        console.log('[RAG] ✓ FTS index created successfully');
    } catch (err) {
        const _ce = /** @type {any} */ (err);
        if (_ce?.message && (_ce.message.includes('already exists') || _ce.message.includes('Index already exists'))) {
            console.log('[RAG] FTS index already exists, skipping');
        } else {
            console.error('[RAG] Failed to create FTS index:', _ce?.message || err);
            throw err;
        }
    }
}

export async function deleteByPath(/** @type {any} */ table, /** @type {any} */ relPath) {
    return await withTimeout(
        /** @type {any} */ async () => {
            const safe = relPath.replace(/'/g, "''");
            await table.delete(`path = '${safe}'`);
        },
        30000,
        'LANCEDB_DELETE_BY_PATH_TIMEOUT',
    );
}

export async function addChunks(
    /** @type {any} */ table,
    /** @type {any} */ rows,
    /** @type {any} */ { batchSize = 32 } = {},
) {
    return await withTimeout(
        /** @type {any} */ async () => {
            let total = 0;
            let retriedWithoutContentClass = false;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                if (batch.length === 0) continue;
                try {
                    await table.add(batch);
                } catch (error) {
                    const _ce = /** @type {any} */ (error);
                    const message = String(_ce?.message || '');
                    const schemaCompatIssue = message.includes('content_class') || message.includes('Unknown column');
                    if (!schemaCompatIssue) {
                        throw error;
                    }
                    const fallbackBatch = batch.map((/** @type {any} */ row) => {
                        const { content_class: _contentClass, ...rest } = row;
                        return rest;
                    });
                    await table.add(fallbackBatch);
                    if (!retriedWithoutContentClass) {
                        retriedWithoutContentClass = true;
                        console.warn(
                            '[RAG] Table schema without content_class detected; writing fallback rows (rebuild recommended).',
                        );
                    }
                }
                total += batch.length;
            }
            return total;
        },
        60000,
        'LANCEDB_ADD_CHUNKS_TIMEOUT',
    );
}

export async function getChunkById(/** @type {any} */ table, /** @type {any} */ chunkId) {
    return await withTimeout(
        /** @type {any} */ async () => {
            const safe = String(chunkId || '').replace(/'/g, "''");
            const rows = await table.query().where(`chunk_id = '${safe}'`).limit(1).toArray();
            if (!rows.length) return null;
            return formatResult(rows[0]);
        },
        15000,
        'LANCEDB_GET_CHUNK_BY_ID_TIMEOUT',
    );
}

export async function getChunkStats(/** @type {any} */ table) {
    return await withTimeout(
        /** @type {any} */ async () => {
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
                    ? ['kind', 'symbol', 'header_text', 'embed_text', 'chunk_prev_id', 'chunk_next_id'].every(
                          (/** @type {any} */ k) => Object.prototype.hasOwnProperty.call(sampleRow, k),
                      )
                    : null,
                sample_has_content_class: sampleRow
                    ? Object.prototype.hasOwnProperty.call(sampleRow, 'content_class')
                    : null,
            };
        },
        15000,
        'LANCEDB_CHUNK_STATS_TIMEOUT',
    );
}

/**
 * @param {{ pathPrefix?: string; ext?: string; tags?: string[] }} [filters]
 */
function buildWhere(/** @type {any} */ { pathPrefix, ext, tags } = {}) {
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
 * @param {{
 *     topK?: number;
 *     filters?: { pathPrefix?: string; ext?: string; tags?: string[] };
 *     distanceRange?: [number, number] | { min?: number; max?: number };
 * }} [options]
 */
export async function search(
    /** @type {any} */ table,
    /** @type {any} */ vector,
    /** @type {any} */ { topK = 8, filters = {}, distanceRange } = {},
) {
    return await withTimeout(
        /** @type {any} */ async () => {
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
                filtered = rows.filter(
                    (/** @type {any} */ r) =>
                        Array.isArray(r.tags) && [...required].every((/** @type {any} */ t) => r.tags.includes(t)),
                );
            }

            filtered.sort((/** @type {any} */ a, /** @type {any} */ b) => {
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
        'LANCEDB_SEARCH_TIMEOUT',
    );
}

/**
 * @param {any} table
 * @param {number[]} vector
 * @param {string} textQuery
 * @param {{
 *     topK?: number;
 *     filters?: { pathPrefix?: string; ext?: string; tags?: string[] };
 *     distanceRange?: [number, number] | { min?: number; max?: number };
 *     rerank?: boolean;
 *     rerankWeights?: object;
 *     intentScope?: 'code-first' | 'docs-first' | 'all';
 *     mmr?: boolean;
 *     mmrLambda?: number;
 * }} [options]
 */
export async function hybridSearch(
    /** @type {any} */ table,
    /** @type {any} */ vector,
    /** @type {any} */ textQuery,
    /** @type {any} */ options = {},
) {
    return await withTimeout(
        /** @type {any} */ async () => {
            const {
                topK = 8,
                filters = {},
                distanceRange,
                rerank: shouldRerank = true,
                rerankWeights,
                intentScope = 'code-first',
                mmr: shouldMMR = true,
                mmrLambda = 0.7,
            } = options;

            let q = table.query().fullTextSearch(textQuery).nearestTo(vector);

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
                filtered = rows.filter(
                    (/** @type {any} */ r) =>
                        Array.isArray(r.tags) && [...required].every((/** @type {any} */ t) => r.tags.includes(t)),
                );
            }

            filtered.sort((/** @type {any} */ a, /** @type {any} */ b) => {
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
                results = rerank(results, textQuery, { weights: rerankWeights, intentScope });
            }

            if (shouldMMR && results.length > topK) {
                console.log(`[RAG] Applying MMR for diversity (lambda=${mmrLambda})...`);
                results = maximalMarginalRelevance(results, {
                    lambda: mmrLambda,
                    topK,
                });
            } else {
                results = results.slice(0, topK);
            }

            return results;
        },
        60000,
        'LANCEDB_HYBRID_SEARCH_TIMEOUT',
    );
}

export async function lexicalSearch(
    /** @type {any} */ table,
    /** @type {any} */ textQuery,
    /** @type {any} */ options = {},
) {
    return await withTimeout(
        /** @type {any} */ async () => {
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
                filtered = rows.filter(
                    (/** @type {any} */ r) =>
                        Array.isArray(r.tags) && [...required].every((/** @type {any} */ t) => r.tags.includes(t)),
                );
            }

            filtered.sort((/** @type {any} */ a, /** @type {any} */ b) => {
                const sa = typeof a._score === 'number' ? a._score : 0;
                const sb = typeof b._score === 'number' ? b._score : 0;
                if (sa !== sb) return sb - sa;
                if (a.path !== b.path) return String(a.path).localeCompare(String(b.path));
                if (a.start_line !== b.start_line) return (a.start_line || 0) - (b.start_line || 0);
                return String(a.chunk_id).localeCompare(String(b.chunk_id));
            });

            return filtered.slice(0, topK).map(
                (/** @type {any} */ row) =>
                    /** @type {any} */ ({
                        ...formatResult(row),
                        score: typeof row._score === 'number' ? row._score : 0,
                    }),
            );
        },
        45000,
        'LANCEDB_LEXICAL_SEARCH_TIMEOUT',
    );
}

function formatResult(/** @type {any} */ row) {
    const indexedAtMs = normalizeIndexedAtMs(row.indexed_at);
    return {
        score: typeof row._distance === 'number' ? -row._distance : 0,
        distance: row._distance,
        chunk_id: row.chunk_id,
        file_id: row.file_id,
        path: row.path,
        ext: row.ext,
        content_class: normalizeContentClass(row.content_class, row.path, row.ext),
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
        indexed_at_local: indexedAtMs ? toLocalSecond(indexedAtMs) : null,
    };
}

function normalizeIndexedAtMs(/** @type {any} */ value) {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function toIsoSecond(/** @type {any} */ epochMs) {
    const iso = new Date(epochMs).toISOString();
    return iso.replace(/\.\d{3}Z$/, 'Z');
}

function toLocalSecond(/** @type {any} */ epochMs) {
    const d = new Date(epochMs);
    const pad = (/** @type {any} */ n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
