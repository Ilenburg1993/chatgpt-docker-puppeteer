// @ts-check

import { describe, expect, it } from 'vitest';
import { getIoLatencyStats, recordIoLatency } from '../../../../src/copilot/infra/io-observability.js';

describe('infra/io-observability bounds', () => {
    it('limits diagnostic histogram cardinality for dynamic operation names', () => {
        for (let i = 0; i < 80; i++) {
            recordIoLatency(`dynamic-operation-${i}`, i + 1);
        }

        const stats = getIoLatencyStats();
        expect(Object.keys(stats).length).toBeLessThanOrEqual(64);
        expect(stats['dynamic-operation-0']).toBeUndefined();
        expect(stats['dynamic-operation-79']?.count).toBe(1);
    });
});
