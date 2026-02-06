import { connect } from '@lancedb/lancedb';
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
    return sliced.map(r => ({
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
        embedding_model: r.embedding_model
    }));
}

