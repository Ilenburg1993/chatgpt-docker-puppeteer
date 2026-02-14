import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { ragIndex, ragIndexChanged, ragQuery } from '../../../tools/rag/lib/facade.mjs';

class FakeEmbeddingsProvider {
    constructor(dim = 8) {
        this.dim = dim;
        this.model = 'fake-embeddings';
    }

    async health() {
        return { ok: true, hasModel: true, models: [this.model] };
    }

    async embed(text) {
        const hash = crypto.createHash('sha256').update(String(text), 'utf8').digest();
        const vector = [];
        for (let i = 0; i < this.dim; i++) vector.push(hash[i] / 255);
        return vector;
    }
}

describe('ragIndexChanged', () => {
    it('reindexes only changed paths and returns timestamp fields on query', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index')
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'a.ts'), 'export const A = 1;\n', 'utf8');
            await fs.writeFile(path.join(ws, 'b.ts'), 'export const B = 2;\n', 'utf8');

            await ragIndex({ root: ws, paths: ragPaths, embeddingsProvider: embeddings, profile: 'full' });

            const manifestPath = path.join(ragPaths.indexDir, 'manifest.v1.json');
            const before = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            const bBefore = before.files['b.ts'].indexed_at;

            await fs.writeFile(path.join(ws, 'a.ts'), 'export const A = 999;\n', 'utf8');

            const report = await ragIndexChanged({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
                changedPaths: ['a.ts']
            });

            assert.strictEqual(report.changed_files, 1);
            assert.strictEqual(report.deleted_files, 0);

            const after = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            assert.strictEqual(after.last_index_mode, 'incremental');
            assert.strictEqual(after.files['b.ts'].indexed_at, bBefore);
            assert.ok(after.files['a.ts'].indexed_at >= before.files['a.ts'].indexed_at);
            assert.ok(typeof after.files['a.ts'].indexed_at_iso === 'string');

            const query = await ragQuery({
                query: 'A = 999',
                topK: 2,
                paths: ragPaths,
                embeddingsProvider: embeddings
            });

            assert.ok(Array.isArray(query.results));
            assert.ok(query.results.length >= 1);
            assert.ok(query.results[0].indexed_at_iso);
            assert.ok(query.results[0].indexed_at_local);
            assert.ok(query.index_mode);
            assert.ok(Object.prototype.hasOwnProperty.call(query, 'index_freshness_ms'));
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('removes deleted file from manifest using selective paths', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index')
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'gone.ts'), 'export const GONE = true;\n', 'utf8');

            await ragIndex({ root: ws, paths: ragPaths, embeddingsProvider: embeddings, profile: 'full' });
            await fs.unlink(path.join(ws, 'gone.ts'));

            const report = await ragIndexChanged({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
                changedPaths: ['gone.ts']
            });

            assert.strictEqual(report.deleted_files, 1);
            const manifestPath = path.join(ragPaths.indexDir, 'manifest.v1.json');
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            assert.ok(!manifest.files['gone.ts']);
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
