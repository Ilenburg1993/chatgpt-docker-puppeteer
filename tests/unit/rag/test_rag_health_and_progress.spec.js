// @ts-check
import assert from 'node:assert';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ragHealth, ragIndex } from '../../../tools/rag/lib/facade.mjs';

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
        for (let i = 0; i < this.dim; i++) vector.push((hash[i] ?? 0) / 255);
        return vector;
    }
}

describe('ragHealth availability + indexing progress logs', () => {
    it('returns ok=false and available=false when index metadata is missing', async () => {
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };

        try {
            const health = /** @type {any} */ (
                await ragHealth({ paths: ragPaths, embeddingsProvider: new FakeEmbeddingsProvider(8) })
            );
            assert.strictEqual(health.available, false);
            assert.strictEqual(health.ok, false);
        } finally {
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('returns ok=true and available=true after successful indexing', async () => {
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
            await ragIndex({ root: ws, paths: ragPaths, embeddingsProvider: embeddings, profile: 'full' });

            const health = /** @type {any} */ (await ragHealth({ paths: ragPaths, embeddingsProvider: embeddings }));
            assert.strictEqual(health.available, true);
            assert.strictEqual(health.ok, true);
            assert.ok(typeof health.index_updated_at === 'number');
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('prints progress with percentages/ETA and uses stable chunk numbering per file', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const ragPaths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index'),
        };
        const embeddings = new FakeEmbeddingsProvider(8);
        /** @type {any[]} */ const logs = [];
        const oldLog = console.log;

        try {
            await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify({ name: 'rag-test' }), 'utf8');
            await fs.writeFile(path.join(ws, 'a.ts'), 'export const A = 1;\nexport const B = 2;\n', 'utf8');
            await fs.writeFile(path.join(ws, 'b.ts'), 'export const C = 3;\nexport const D = 4;\n', 'utf8');

            console.log = (...args) => logs.push(args.join(' '));
            await ragIndex({ root: ws, paths: ragPaths, embeddingsProvider: embeddings, profile: 'full' });

            const progressLine = logs.find((line) => line.includes('[RAG] progress files='));
            assert.ok(progressLine, 'Expected progress line with percentages');
            assert.ok(progressLine.includes('remaining='));
            assert.ok(progressLine.includes('chunks~'));
            assert.ok(progressLine.includes('eta='));

            const progressMatch = progressLine.match(/files=(\d+(?:\.\d+)?)% .*chunks~(\d+(?:\.\d+)?)%/);
            assert.ok(progressMatch, 'Expected parseable percentage values');
            assert.ok(Number(progressMatch[1]) >= 0 && Number(progressMatch[1]) <= 100);
            assert.ok(Number(progressMatch[2]) >= 0 && Number(progressMatch[2]) <= 100);

            const oldBrokenPattern = logs.some((line) => /Embedding chunk \d+\/\d+:/.test(line));
            assert.strictEqual(oldBrokenPattern, false);

            const fileChunkLines = logs.filter((line) => line.includes('Embedding chunk file '));
            assert.ok(fileChunkLines.length > 0, 'Expected per-file chunk logs');
            for (const line of fileChunkLines) {
                const match = line.match(/Embedding chunk file (\d+)\/(\d+)/);
                if (!match) continue;
                const current = Number(match[1]);
                const total = Number(match[2]);
                assert.ok(current <= total, `Expected current <= total, got ${line}`);
            }
        } finally {
            console.log = oldLog;
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
