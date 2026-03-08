// @ts-check
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { ragIndex, ragAsk, ragIndexChanged, ragQuery } from '../../../tools/rag/lib/facade.mjs';

class FakeEmbeddingsProvider {
    constructor(dim = 8) {
        this.dim = dim;
        this.model = 'fake-embeddings';
    }
    async health() {
        return { ok: true, hasModel: true, models: [this.model] };
    }
    async embed(/** @type {any} */ text) {
        const hash = crypto.createHash('sha256').update(String(text), 'utf8').digest();
        const v = [];
        for (let i = 0; i < this.dim; i++) v.push((hash[i] ?? 0) / 255);
        return v;
    }
}

describe('RAG end-to-end (no Ollama)', () => {
    it('indexes incrementally and can build markdown context', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const paths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'src.ts'), 'export const CHROME_PROXY_PORT = 9224;\n', 'utf8');

            const r1 = /** @type {any} */ (
                await ragIndex({ root: ws, paths, embeddingsProvider: embeddings, profile: 'full' })
            );
            assert.ok(r1.scanned_files >= 1);
            assert.strictEqual(r1.skipped_files, 0);
            assert.ok(r1.embedded_chunks >= 1);

            const r2 = /** @type {any} */ (
                await ragIndex({ root: ws, paths, embeddingsProvider: embeddings, profile: 'full' })
            );
            assert.strictEqual(r2.changed_files, 0);
            assert.strictEqual(r2.embedded_chunks, 0);

            await fs.writeFile(path.join(ws, 'src.ts'), 'export const CHROME_PROXY_PORT = 9225;\n', 'utf8');

            const r3 = /** @type {any} */ (
                await ragIndex({ root: ws, paths, embeddingsProvider: embeddings, profile: 'full' })
            );
            assert.strictEqual(r3.changed_files, 1);
            assert.ok(r3.embedded_chunks >= 1);

            await fs.writeFile(path.join(ws, 'src.ts'), 'export const CHROME_PROXY_PORT = 9333;\n', 'utf8');
            const inc = /** @type {any} */ (
                await ragIndexChanged({
                    root: ws,
                    paths,
                    changedPaths: ['src.ts'],
                    embeddingsProvider: embeddings,
                    profile: 'full',
                })
            );
            assert.strictEqual(inc.changed_files, 1);

            const { markdown, result } = /** @type {any} */ (
                await ragAsk({
                    query: 'export const CHROME_PROXY_PORT = 9333;',
                    paths,
                    embeddingsProvider: embeddings,
                    topK: 3,
                })
            );

            assert.ok(Array.isArray(result.results));
            assert.ok(markdown.includes('CHROME_PROXY_PORT'));
            assert.ok(markdown.includes('src.ts:1-'));

            const q = /** @type {any} */ (
                await ragQuery({
                    query: 'CHROME_PROXY_PORT',
                    paths,
                    embeddingsProvider: embeddings,
                    topK: 1,
                })
            );
            assert.ok(['full', 'incremental'].includes(q.index_mode));
            assert.ok(Object.prototype.hasOwnProperty.call(q, 'index_freshness_ms'));
            assert.ok(q.results[0].indexed_at_iso);
            assert.ok(q.results[0].kind);
            assert.ok(Object.prototype.hasOwnProperty.call(q.results[0], 'symbol'));
            assert.ok(Object.prototype.hasOwnProperty.call(q.results[0], 'header_text'));
            assert.ok(Object.prototype.hasOwnProperty.call(q.results[0], 'chunk_prev_id'));
            assert.ok(Object.prototype.hasOwnProperty.call(q.results[0], 'chunk_next_id'));
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
