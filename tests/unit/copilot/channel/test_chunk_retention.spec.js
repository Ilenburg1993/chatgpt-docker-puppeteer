// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    createChunkRetention,
    mergeChunkRetentions,
} from '../../../../src/copilot/channel/chunk-retention.js';

describe('channel chunk retention', () => {
    it('bounds auxiliary chunks by physical bytes and item count', () => {
        const retention = createChunkRetention({ maxBytes: 5, maxItems: 2 });
        retention.record('ab');
        retention.record('ç');
        retention.record('z');

        assert.deepEqual(retention.snapshot(), {
            chunks: ['ab', 'ç'],
            observedChunks: 3,
            observedChunkBytes: 5,
            capturedChunkBytes: 4,
            chunksTruncated: true,
        });
    });

    it('can disable retention while preserving observed counters', () => {
        const retention = createChunkRetention({ enabled: false });
        retention.record('ação');

        assert.deepEqual(retention.snapshot(), {
            chunks: [],
            observedChunks: 1,
            observedChunkBytes: 6,
            capturedChunkBytes: 0,
            chunksTruncated: true,
        });
    });

    it('merges retry metadata without unbounded array concatenation', () => {
        assert.deepEqual(
            mergeChunkRetentions(
                [
                    { chunks: ['aa'], observedChunks: 3, observedChunkBytes: 6, chunksTruncated: true },
                    { chunks: ['bb', 'cc'] },
                ],
                { maxBytes: 4, maxItems: 2 },
            ),
            {
                chunks: ['aa', 'bb'],
                observedChunks: 5,
                observedChunkBytes: 10,
                capturedChunkBytes: 4,
                chunksTruncated: true,
            },
        );
    });
});
