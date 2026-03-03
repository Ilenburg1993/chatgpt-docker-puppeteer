// @ts-check
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { ragIndex, ragIndexChanged } from '../../../tools/rag/lib/facade.mjs';

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

describe('RAG scope reconciliation', () => {
    it('prunes markdown files when docsMode changes to exclude on full index', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'a.ts'), 'export const A = 1;\n', 'utf8');
            await fs.writeFile(path.join(ws, 'README.md'), '# Title\n\nhello\n', 'utf8');

            const first = await ragIndex({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
                docsMode: 'include',
            });
            assert.strictEqual(first.scope.docs_mode, 'include');

            const second = await ragIndex({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
                docsMode: 'exclude',
            });
            assert.strictEqual(second.scope.docs_mode, 'exclude');
            assert.ok(second.scope_reconciled);
            assert.ok(second.pruned_files >= 1);

            const manifestPath = path.join(ragPaths.indexDir, 'manifest.v1.json');
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            assert.ok(!manifest.files['README.md']);
            assert.strictEqual(manifest.last_scope.docs_mode, 'exclude');
            assert.ok(typeof manifest.last_scope_hash === 'string' && manifest.last_scope_hash.length > 0);
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('reconciles scope drift on ragIndexChanged even with no changed paths', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'README.md'), '# Title\n\nhello\n', 'utf8');

            await ragIndex({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                profile: 'full',
                docsMode: 'include',
            });

            const report = await ragIndexChanged({
                root: ws,
                paths: ragPaths,
                embeddingsProvider: embeddings,
                changedPaths: [],
                profile: 'full',
                docsMode: 'exclude',
            });
            assert.ok(report.scope_reconciled);
            assert.ok(report.pruned_files >= 1);

            const manifestPath = path.join(ragPaths.indexDir, 'manifest.v1.json');
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            assert.ok(!manifest.files['README.md']);
            assert.strictEqual(manifest.last_scope.docs_mode, 'exclude');
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
