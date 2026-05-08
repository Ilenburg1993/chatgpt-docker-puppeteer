import { describe, expect, it } from 'vitest';

import { getIoL2CacheHealth, getIoL2CacheStats } from '../../../../src/copilot/infra/io-cache-l2-registry.js';

describe('io-cache-l2-registry', () => {
    it('returns disabled status and health contract by default', () => {
        const stats = getIoL2CacheStats();
        expect(stats.enabled).toBe(false);
        expect('reason' in stats ? stats.reason : undefined).toBe('disabled');

        const health = getIoL2CacheHealth();
        expect(health.available).toBe(false);
        expect(health.reason).toBe('disabled');
    });
});
