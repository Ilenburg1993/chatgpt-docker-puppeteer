import { afterEach, describe, expect, it } from 'vitest';

import {
    getIoL2CacheHealth,
    getIoL2CacheStats,
    resetIoL2CacheForTest,
} from '../../../../src/copilot/infra/io-cache-l2-registry.js';

describe('io-cache-l2-registry', () => {
    afterEach(() => {
        delete process.env['IO_L2_CACHE_ENABLED'];
        resetIoL2CacheForTest();
    });

    it('returns disabled status and health contract by default', () => {
        const stats = getIoL2CacheStats();
        expect(stats.enabled).toBe(false);
        expect('reason' in stats ? stats.reason : undefined).toBe('disabled');

        const health = getIoL2CacheHealth();
        expect(health.available).toBe(false);
        expect(health.reason).toBe('disabled');
    });

    it.each(['1', 'true', 'yes', 'on'])('accepts %s as an enabled boolean value', (value) => {
        process.env['IO_L2_CACHE_ENABLED'] = value;
        const health = getIoL2CacheHealth();
        expect(health.reason).not.toBe('disabled');
    });
});
