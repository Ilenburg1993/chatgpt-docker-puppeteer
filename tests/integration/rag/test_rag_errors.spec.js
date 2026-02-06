import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ragIndex, ragReset } from '../../../tools/rag/lib/facade.mjs';

// Fake embeddings provider for testing
class FakeEmbeddingsProvider {
    constructor(options = {}) {
        this.dim = options.dim || 8;
        this.model = options.model || 'fake-model';
        this.shouldFail = options.shouldFail || false;
    }

    async health() {
        return { ok: true, hasModel: true, models: [this.model] };
    }

    async embed(text) {
        if (this.shouldFail) {
            throw new Error('FAKE_EMBEDDING_ERROR');
        }
        // Generate deterministic vector from text hash
        const hash = Buffer.from(text).toString('hex').slice(0, this.dim * 2);
        const vector = [];
        for (let i = 0; i < this.dim; i++) {
            vector.push(parseInt(hash.slice(i * 2, i * 2 + 2), 16) / 255);
        }
        return vector;
    }
}

describe('RAG Error Scenarios', () => {
    it('fails with clear message on schema version mismatch', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const paths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index')
        };

        try {
            // Create a workspace with one file
            await fs.writeFile(path.join(ws, 'test.js'), 'const x = 1;', 'utf8');

            // First indexation with normal embeddings
            await ragIndex({ 
                root: ws, 
                paths, 
                embeddingsProvider: new FakeEmbeddingsProvider({ dim: 8 }) 
            });

            // Manually corrupt the manifest to simulate schema mismatch
            const manifestPath = path.join(paths.indexDir, 'manifest.v1.json');
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            manifest.schema_version = 999; // Invalid version
            await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

            // Try to index again - should fail with clear error
            await assert.rejects(
                async () => {
                    await ragIndex({ 
                        root: ws, 
                        paths, 
                        embeddingsProvider: new FakeEmbeddingsProvider({ dim: 8 }) 
                    });
                },
                (err) => {
                    assert.ok(err.message.includes('SCHEMA_VERSION_MISMATCH'));
                    assert.ok(err.message.includes('npm run rag:reset'));
                    return true;
                }
            );
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('fails with clear message on dimension mismatch', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const paths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index')
        };

        try {
            await fs.writeFile(path.join(ws, 'test.js'), 'const x = 1;', 'utf8');

            // Index with 8-dim embeddings
            await ragIndex({ 
                root: ws, 
                paths, 
                embeddingsProvider: new FakeEmbeddingsProvider({ dim: 8 }) 
            });

            // Try to index with different dimension - should fail fast
            await assert.rejects(
                async () => {
                    await ragIndex({ 
                        root: ws, 
                        paths, 
                        embeddingsProvider: new FakeEmbeddingsProvider({ dim: 16 }) // Different!
                    });
                },
                (err) => {
                    assert.ok(err.message.includes('EMBEDDING_DIM_MISMATCH'));
                    assert.ok(err.message.includes('dim=8'));
                    assert.ok(err.message.includes('dim=16'));
                    return true;
                }
            );
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('retries on embedding failure', async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ws-'));
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const paths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index')
        };

        try {
            await fs.writeFile(path.join(ws, 'test.js'), 'const x = 1;', 'utf8');

            // Create provider that fails first 2 times then succeeds
            let attempts = 0;
            const flakyProvider = {
                model: 'flaky-model',
                async health() {
                    return { ok: true, hasModel: true, models: ['flaky-model'] };
                },
                async embed(text) {
                    attempts++;
                    if (attempts <= 2) {
                        throw new Error('TEMPORARY_ERROR');
                    }
                    // Succeed on 3rd attempt
                    return new Array(8).fill(0.5);
                }
            };

            // Should succeed after retries
            const result = await ragIndex({ 
                root: ws, 
                paths, 
                embeddingsProvider: flakyProvider 
            });

            assert.strictEqual(result.scanned_files, 1);
            assert.strictEqual(result.changed_files, 1);
            assert.ok(attempts >= 3, 'Should have retried');
        } finally {
            await fs.rm(ws, { recursive: true, force: true });
            await fs.rm(store, { recursive: true, force: true });
        }
    });

    it('reset requires --yes flag', async () => {
        const store = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-store-'));
        const paths = {
            dbDir: path.join(store, 'rag-db'),
            indexDir: path.join(store, 'rag-index')
        };

        try {
            // Create dirs
            await fs.mkdir(paths.dbDir, { recursive: true });
            await fs.mkdir(paths.indexDir, { recursive: true });

            // Try reset without yes flag - should fail
            await assert.rejects(
                async () => {
                    await ragReset({ paths, yes: false });
                },
                (err) => {
                    assert.ok(err.message.includes('--yes'));
                    return true;
                }
            );

            // With yes flag - should succeed
            await ragReset({ paths, yes: true });
        } finally {
            await fs.rm(store, { recursive: true, force: true });
        }
    });
});
