import { describe, expect, it } from 'vitest';

import { getIoL2CacheStats } from '../../../../src/copilot/infra/io-cache-l2-registry.js';

describe('io-cache-l2-registry', () => {
    it('returns disabled status by default', () => {
        const stats = getIoL2CacheStats();
        expect(stats.enabled).toBe(false);
    });
});
