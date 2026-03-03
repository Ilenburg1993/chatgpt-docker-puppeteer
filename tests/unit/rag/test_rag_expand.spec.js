// @ts-check
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { ragIndex, ragQuery, ragExpand } from '../../../tools/rag/lib/facade.mjs';

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

describe('ragExpand', () => {
    it('returns structured error for invalid chunk id', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-expand-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-expand-store-'));
        const paths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-expand-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'a.ts'), 'export const A = 1;\n', 'utf8');

            await ragIndex({
                root: ws,
                paths,
                embeddingsProvider: embeddings,
                profile: 'full',
            });

            const result = await ragExpand({
                paths,
                root: ws,
                chunkId: 'non-existent',
            });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.reason_code, 'CHUNK_NOT_FOUND');
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('expands by lines and respects file boundaries', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-expand-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-expand-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-expand-test' }), 'utf8');
            await fs.mkdir(path.join(ws, 'src'), { recursive: true });
            await fs.writeFile(
                path.join(ws, 'src', 'sample.ts'),
                [
                    'export function hello(name) {',
                    '  const prefix = "hello";',
                    '  return `${prefix}-${name}`;',
                    '}',
                    '',
                    'export const value = 42;',
                    '',
                ].join('\n'),
                'utf8'
            );

            await ragIndex({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
            });

            const query = await ragQuery({
                query: 'hello(name)',
                topK: 1,
                paths: ragPaths,
                embeddingsProvider: embeddings,
            });
            const chunkId = query.results?.[0]?.chunk_id;
            assert.ok(chunkId, 'Expected at least one indexed chunk');

            const expanded = await ragExpand({
                paths: ragPaths,
                root: ws,
                chunkId,
                mode: 'lines',
                beforeLines: 200,
                afterLines: 200,
            });

            assert.strictEqual(expanded.ok, true);
            assert.strictEqual(expanded.mode, 'lines');
            assert.ok(expanded.range.start_line >= 1);
            assert.ok(expanded.range.end_line <= 7);
            assert.ok(expanded.text.includes('export function hello'));
            assert.ok(expanded.indexed_at_iso);
            assert.ok(expanded.query_at_iso);
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('supports symbol expansion mode', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-expand-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-expand-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-expand-test' }), 'utf8');
            await fs.mkdir(path.join(ws, 'src'), { recursive: true });

            const body = Array.from({ length: 700 }, (_, i) => `  const line_${i} = ${i};`).join('\n');
            await fs.writeFile(
                path.join(ws, 'src', 'big.ts'),
                ['export function heavySymbol() {', body, '  return line_1 + line_699;', '}', ''].join('\n'),
                'utf8'
            );

            await ragIndex({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
            });

            const query = await ragQuery({
                query: 'line_699',
                topK: 1,
                paths: ragPaths,
                embeddingsProvider: embeddings,
            });
            const chunkId = query.results?.[0]?.chunk_id;
            assert.ok(chunkId, 'Expected indexed chunk for heavySymbol');

            const expanded = await ragExpand({
                paths: ragPaths,
                root: ws,
                chunkId,
                mode: 'symbol',
                beforeLines: 0,
                afterLines: 0,
            });

            assert.strictEqual(expanded.ok, true);
            assert.strictEqual(expanded.mode, 'symbol');
            assert.strictEqual(expanded.expansion_basis, 'symbol');
            assert.ok(expanded.base_range.end_line > query.results[0].end_line);
            assert.ok(expanded.text.includes('export function heavySymbol'));
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
