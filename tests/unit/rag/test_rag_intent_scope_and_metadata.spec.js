// @ts-check
import assert from 'node:assert';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ragHybridSearch, ragIndex } from '../../../tools/rag/lib/facade.mjs';

class FakeEmbeddingsProvider {
    constructor(dim = 8) {
        this.dim = dim;
        this.model = 'fake-embeddings';
    }

    async health() {
        return { ok: true, hasModel: true, models: [this.model] };
    }

    async embed(/** @type {string} */ text) {
        const hash = crypto.createHash('sha256').update(String(text), 'utf8').digest();
        const vector = [];
        for (let i = 0; i < this.dim; i += 1) vector.push((hash[i] ?? 0) / 255);
        return vector;
    }
}

describe('ragHybridSearch intent scope + source metadata', () => {
    it('prioritizes code/config by default and exposes file metadata', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-intent-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-intent-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-intent-test' }), 'utf8');
            await fs.mkdir(path.join(ws, 'src'), { recursive: true });
            await fs.mkdir(path.join(ws, 'docs'), { recursive: true });
            await fs.writeFile(path.join(ws, 'src', 'engine.js'), 'export const SHARED_TERM = "dualsource";\n', 'utf8');
            await fs.writeFile(path.join(ws, 'docs', 'guide.md'), '# Guide\ndualsource appears here too\n', 'utf8');

            await ragIndex({ root: ws, paths: ragPaths, embeddingsProvider: embeddings, profile: 'full' });

            const query = await ragHybridSearch({
                query: 'dualsource',
                mode: 'hybrid',
                topK: 2,
                intentScope: 'code-first',
                profile: 'full',
                paths: ragPaths,
                embeddingsProvider: embeddings,
            });

            assert.ok(query.results.length >= 1);
            const first = query.results[0];
            assert.notStrictEqual(first.content_class, 'docs');
            assert.ok(typeof first.path_root_rel === 'string' && first.path_root_rel.length > 0);
            assert.ok(first.file_mtime_ms === null || Number.isFinite(first.file_mtime_ms));
            assert.ok(first.file_mtime_iso === null || typeof first.file_mtime_iso === 'string');
            assert.ok(first.indexed_at_iso === null || typeof first.indexed_at_iso === 'string');
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('supports docs-first and auto-expand with budget', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-intent-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-intent-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-intent-test' }), 'utf8');
            await fs.mkdir(path.join(ws, 'src'), { recursive: true });
            await fs.mkdir(path.join(ws, 'docs'), { recursive: true });
            await fs.writeFile(path.join(ws, 'src', 'engine.js'), 'export const SEARCHABLE = "scopeprobe";\n', 'utf8');
            await fs.writeFile(path.join(ws, 'docs', 'guide.md'), '# Guide\nscopeprobe in docs\n', 'utf8');

            await ragIndex({ root: ws, paths: ragPaths, embeddingsProvider: embeddings, profile: 'full' });

            const query = await ragHybridSearch({
                query: 'scopeprobe',
                mode: 'hybrid',
                topK: 2,
                intentScope: 'docs-first',
                autoExpand: true,
                expandMode: 'lines',
                expandTopN: 1,
                expandBudgetChars: 6000,
                profile: 'full',
                paths: ragPaths,
                embeddingsProvider: embeddings,
                root: ws,
            });

            assert.ok(query.results.length >= 1);
            assert.strictEqual(query.intent_scope, 'docs-first');
            assert.ok(query.result_policy);
            assert.strictEqual(query.result_policy.intent_scope, 'docs-first');
            assert.strictEqual(typeof query.result_policy.auto_expand_applied, 'boolean');

            const first = query.results[0];
            assert.strictEqual(first.content_class, 'docs');
            if (query.result_policy.auto_expand_applied) {
                assert.ok(first.expanded_context);
                assert.ok(typeof first.expanded_context.text === 'string');
            }
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
