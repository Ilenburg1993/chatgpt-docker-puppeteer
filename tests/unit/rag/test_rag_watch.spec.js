// @ts-check
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { RagWatchBatcher } from '../../../tools/rag/watch.mjs';

function sleep(/** @type {number} */ ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('RagWatchBatcher', () => {
    it('debounces events, deduplicates paths and splits by batch size', async () => {
        /** @type {any[]} */ const batches = [];
        const batcher = new RagWatchBatcher({
            debounceMs: 40,
            batchMax: 2,
            onBatch: async (/** @type {any} */ batch) => {
                batches.push(batch);
            },
        });

        batcher.enqueue('src/a.ts');
        batcher.enqueue('src/a.ts');
        batcher.enqueue('src/b.ts');
        batcher.enqueue('src/c.ts');

        await sleep(120);
        await batcher.close();

        assert.strictEqual(batches.length, 2);
        assert.deepStrictEqual(batches[0], ['src/a.ts', 'src/b.ts']);
        assert.deepStrictEqual(batches[1], ['src/c.ts']);
    });
});
