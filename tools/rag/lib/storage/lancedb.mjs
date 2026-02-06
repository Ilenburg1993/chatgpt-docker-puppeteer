import { connect, Index } from '@lancedb/lancedb';
import { Schema, Field, Utf8, Int32, Int64, Float32, FixedSizeList, List } from 'apache-arrow';

export const TABLE_NAME = 'chunks_v1';

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
        new Field('start_line', new Int32(), false),
        new Field('end_line', new Int32(), false),
        new Field('start_byte', new Int32(), false),
        new Field('end_byte', new Int32(), false),
        new Field('tags', new List(new Field('item', new Utf8(), true)), true),
        new Field('text', new Utf8(), false),
        new Field('content_sha256', new Utf8(), false),
        new Field('embedding_model', new Utf8(), false),
        new Field('vector', new FixedSizeList(embeddingDim, new Field('item', new Float32(), true)), false),
        new Field('indexed_at', new Int64(), false)
    ]);
}

export async function ensureTable(db, embeddingDim) {
    const tables = await db.tableNames();
    if (tables.includes(TABLE_NAME)) {
        return db.openTable(TABLE_NAME);
    }
    const schema = buildSchema(embeddingDim);
    await db.createEmptyTable(TABLE_NAME, schema);
    return db.openTable(TABLE_NAME);
}

/**
 * Create Full-Text Search index on 'text' column
 * @param {Table} table - LanceDB table
 * @param {object} options - Index options (currently unused, reserved for future)
 * @returns {Promise<void>}
 */
export async function createFTSIndex(table, options = {}) {
    console.log('[RAG] Creating FTS index on "text" column...');
    try {
        // LanceDB v0.24 API: await table.createIndex(columnName, { config: Index.fts() })
        await table.createIndex('text', { config: Index.fts() });
        console.log('[RAG] ✓ FTS index created successfully');
    } catch (err) {
        if (err.message && (err.message.includes('already exists') || err.message.includes('Index already exists'))) {
            console.log('[RAG] FTS index already exists, skipping');
        } else {
            console.error('[RAG] Failed to create FTS index:', err.message);
            throw err;
        }
    }
}

export async function deleteByPath(table, relPath) {
    const safe = relPath.replace(/'/g, "''");
    await table.delete(`path = '${safe}'`);
}

export async function addChunks(table, rows, { batchSize = 32 } = {}) {
    let total = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        if (batch.length === 0) continue;
        await table.add(batch);
        total += batch.length;
    }
    return total;
}

function buildWhere({ pathPrefix, ext, tags }) {
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
        // DataFusion supports `array_has` for list? Not guaranteed. We'll client-filter tags.
    }
    return parts.length ? parts.join(' AND ') : null;
}

export async function search(table, vector, { topK = 8, filters = {}, distanceRange } = {}) {
    const where = buildWhere(filters);
    let q = table.search(vector);

    // LanceDB v0.24: Distance range filtering (discard irrelevant results)
    // distanceRange: { min, max } or [min, max]
    // Example: distanceRange: [0, 0.8] filters out results with distance > 0.8
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
        filtered = rows.filter(r => Array.isArray(r.tags) && [...required].every(t => r.tags.includes(t)));
    }

    filtered.sort((a, b) => {
        const da = typeof a._distance === 'number' ? a._distance : 0;
        const db = typeof b._distance === 'number' ? b._distance : 0;
        if (da !== db) return da - db; // smaller distance first
        if (a.path !== b.path) return String(a.path).localeCompare(String(b.path));
        if (a.start_line !== b.start_line) return (a.start_line || 0) - (b.start_line || 0);
        return String(a.chunk_id).localeCompare(String(b.chunk_id));
    });

    const sliced = filtered.slice(0, topK);
    return sliced.map(formatResult);
}

/**
 * Hybrid search: Vector (semantic) + FTS (lexical)
 * Combines vector similarity with full-text search for better precision
 * @param {Table} table - LanceDB table
 * @param {number[]} vector - Query embedding
 * @param {string} textQuery - Original query text for FTS
 * @param {object} options - Search options
 * @returns {Promise<object[]>} - Ranked results
 */
export async function hybridSearch(table, vector, textQuery, options = {}) {
    const {
        topK = 8,
        filters = {},
        distanceRange
    } = options;

    // LanceDB v0.24 API: query().fullTextSearch().nearestTo()
    let q = table
        .query()
        .fullTextSearch(textQuery)  // FTS search on indexed 'text' column
        .nearestTo(vector);         // Vector search (HNSW)

    // Apply distance range filter (if specified)
    if (distanceRange) {
        const [min, max] = Array.isArray(distanceRange)
            ? distanceRange
            : [distanceRange.min || 0, distanceRange.max || 1];
        q = q.distanceRange(min, max);
    }

    // Over-fetch for filtering (5x topK)
    q = q.limit(topK * 5);

    // Apply WHERE filters (path, ext)
    const where = buildWhere(filters);
    if (where) q = q.where(where);

    // Execute query
    const rows = await q.toArray();

    // Client-side tag filtering (LanceDB WHERE doesn't support array contains well)
    let filtered = rows;
    if (filters?.tags?.length) {
        const required = new Set(filters.tags.map(String));
        filtered = rows.filter(r =>
            Array.isArray(r.tags) && [...required].every(t => r.tags.includes(t))
        );
    }

    // Sort by combined score (LanceDB already blended vector + FTS)
    filtered.sort((a, b) => {
        const da = typeof a._distance === 'number' ? a._distance : 0;
        const db = typeof b._distance === 'number' ? b._distance : 0;
        if (da !== db) return da - db;
        if (a.path !== b.path) return String(a.path).localeCompare(String(b.path));
        if (a.start_line !== b.start_line) return (a.start_line || 0) - (b.start_line || 0);
        return String(a.chunk_id).localeCompare(String(b.chunk_id));
    });

    // Return top K
    return filtered.slice(0, topK).map(formatResult);
}

function formatResult(r) {
    return {
        score: typeof r._distance === 'number' ? -r._distance : 0,
        distance: r._distance,
        chunk_id: r.chunk_id,
        file_id: r.file_id,
        path: r.path,
        ext: r.ext,
        language: r.language ?? undefined,
        start_line: r.start_line,
        end_line: r.end_line,
        start_byte: r.start_byte,
        end_byte: r.end_byte,
        tags: r.tags || [],
        text: r.text,
        content_sha256: r.content_sha256,
        embedding_model: r.embedding_model,
        indexed_at: r.indexed_at
    };
}

