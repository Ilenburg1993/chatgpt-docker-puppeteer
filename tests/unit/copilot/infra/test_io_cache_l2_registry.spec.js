import { afterEach, describe, expect, it } from 'vitest';

import { listShutdownHandlers, SHUTDOWN_PRIORITY } from '../../../../src/copilot/core/index.js';
import {
    getIoL2Cache,
    getIoL2CacheConfiguration,
    getIoL2CacheHealth,
    getIoL2CacheStats,
    resetIoL2CacheForTest,
} from '../../../../src/copilot/infra/io-cache-l2-registry.js';
import { readIoRuntimeHealthSnapshot } from '../../../../src/copilot/infra/io-health.js';

describe('io-cache-l2-registry', () => {
    afterEach(() => {
        delete process.env['IO_L2_CACHE_ENABLED'];
        delete process.env['IO_L2_CACHE_PROFILE'];
        delete process.env['IO_L2_CACHE_TTL_MS'];
        delete process.env['IO_L2_CACHE_MAX_ENTRIES'];
        delete process.env['IO_L2_CACHE_PRUNE_MS'];
        delete process.env['IO_L2_CACHE_MIN_BYTES'];
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

    it('uses conservative defaults for the experimental profile', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'experimental';

        expect(getIoL2CacheConfiguration()).toMatchObject({
            enabled: true,
            profile: 'experimental',
            profileSource: 'IO_L2_CACHE_PROFILE',
            configurationValid: true,
            ttlMs: 60_000,
            maxEntries: 10_000,
            pruneMs: 60_000,
            minBytes: 0,
        });
    });

    it('registers persistence before the database shutdown handler', () => {
        getIoL2Cache();

        expect(listShutdownHandlers()).toContainEqual(
            expect.objectContaining({
                name: 'copilot-io-l2.flush',
                priority: SHUTDOWN_PRIORITY.CACHE_PERSISTENCE,
            }),
        );
        expect(SHUTDOWN_PRIORITY.CACHE_PERSISTENCE).toBeLessThan(SHUTDOWN_PRIORITY.DATABASE);
    });

    it('lets the explicit profile override the legacy enable flag', () => {
        process.env['IO_L2_CACHE_ENABLED'] = 'true';
        process.env['IO_L2_CACHE_PROFILE'] = 'off';

        expect(getIoL2CacheConfiguration()).toMatchObject({
            enabled: false,
            profile: 'off',
            profileSource: 'IO_L2_CACHE_PROFILE',
        });
    });

    it('reconfigures the live cache when the explicit profile changes', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'experimental';
        const experimental = getIoL2Cache();
        experimental?.set({ key: 'pending', path: '/tmp/pending', payload: 'pending' });

        process.env['IO_L2_CACHE_PROFILE'] = 'on';
        const on = getIoL2Cache();

        expect(experimental?.ttlMs).toBe(60_000);
        expect(experimental?.getStats()).toMatchObject({ pendingSets: 0, batchedRows: 1 });
        expect(on?.ttlMs).toBe(300_000);
        expect(on).not.toBe(experimental);
    });

    it('fails closed and emits a health alert for invalid profiles', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'turbo';

        expect(getIoL2CacheStats()).toMatchObject({
            enabled: false,
            reason: 'invalid-profile',
            profile: 'invalid',
            configurationValid: false,
            rawProfile: 'turbo',
        });
        expect(readIoRuntimeHealthSnapshot().alerts).toContainEqual(
            expect.objectContaining({
                code: 'IO_L2_PROFILE_INVALID',
                severity: 'high',
            }),
        );
    });
});
