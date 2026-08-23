// @ts-check

import { createIoL2CacheRuntime, getIoL2CacheConfiguration } from '#copilot/infra/internal/cache/l2';
import { createInfraSqliteProviderBinding } from '#copilot/infra/internal/database/provider';
import { createBetterSqliteProvider } from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readIoRuntimeHealthSnapshot } from '../../../../src/copilot/infra/observability/health.js';

/** @type {import('better-sqlite3').Database | null} */
let testDb = null;
/** @type {ReturnType<typeof createIoL2CacheRuntime> | null} */
let l2Runtime = null;
/** @type {ReturnType<typeof createInfraSqliteProviderBinding> | null} */
let databaseBinding = null;

function requireL2Runtime() {
    if (!l2Runtime) throw new Error('test L2 runtime is not initialized');
    return l2Runtime;
}

function recreateL2Runtime() {
    l2Runtime?.dispose();
    if (!databaseBinding) throw new Error('test database binding is not initialized');
    l2Runtime = createIoL2CacheRuntime({
        database: databaseBinding,
        runtimeId: `test-l2-${Date.now()}-${Math.random()}`,
        configuration: getIoL2CacheConfiguration(process.env),
    });
    return l2Runtime;
}

describe('io-cache-l2 runtime ownership', () => {
    beforeEach(() => {
        testDb = new Database(':memory:');
        databaseBinding = createInfraSqliteProviderBinding(
            createBetterSqliteProvider(() => /** @type {import('better-sqlite3').Database} */ (testDb)),
        );
        recreateL2Runtime();
    });

    afterEach(() => {
        delete process.env['IO_L2_CACHE_PROFILE'];
        delete process.env['IO_L2_CACHE_TTL_MS'];
        delete process.env['IO_L2_CACHE_MAX_ENTRIES'];
        delete process.env['IO_L2_CACHE_PRUNE_MS'];
        delete process.env['IO_L2_CACHE_MIN_BYTES'];
        l2Runtime?.dispose();
        l2Runtime = null;
        databaseBinding = null;
        if (testDb?.open) testDb.close();
        testDb = null;
    });

    it('returns disabled status and health contract by default', () => {
        const stats = requireL2Runtime().stats();
        expect(stats.enabled).toBe(false);
        expect('reason' in stats ? stats.reason : undefined).toBe('disabled');

        const health = requireL2Runtime().health();
        expect(health.available).toBe(false);
        expect(health.reason).toBe('disabled');
    });

    it('uses conservative defaults for the experimental profile', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'experimental';

        expect(getIoL2CacheConfiguration(process.env)).toMatchObject({
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

    it('is lifecycle-self-owned and has no dependency on application process shutdown', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'experimental';
        recreateL2Runtime();
        expect(requireL2Runtime().get()).not.toBeNull();
        const source = readFileSync(resolve('src/copilot/infra/cache/l2/cache-runtime.js'), 'utf8');
        expect(source).not.toMatch(/process-runtime|shutdown|registerApplicationShutdownHandler/u);
    });

    it('keeps explicit off as the single disabled configuration', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'off';

        expect(getIoL2CacheConfiguration(process.env)).toMatchObject({
            enabled: false,
            profile: 'off',
            profileSource: 'IO_L2_CACHE_PROFILE',
        });
    });

    it('freezes the profile for a live runtime and captures changes only in a new runtime', () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'experimental';
        recreateL2Runtime();
        const experimental = requireL2Runtime().get();
        expect(experimental?.ttlMs).toBe(60_000);

        process.env['IO_L2_CACHE_PROFILE'] = 'on';
        expect(requireL2Runtime().get()).toBe(experimental);
        expect(requireL2Runtime().snapshot()).toMatchObject({ profile: 'experimental' });

        recreateL2Runtime();
        const on = requireL2Runtime().get();
        expect(on?.ttlMs).toBe(300_000);
        expect(on).not.toBe(experimental);
        expect(requireL2Runtime().snapshot()).toMatchObject({ profile: 'on' });
    });

    it('fails closed and emits a runtime-owned health alert for invalid profiles', async () => {
        process.env['IO_L2_CACHE_PROFILE'] = 'turbo';
        recreateL2Runtime();

        expect(requireL2Runtime().stats()).toMatchObject({
            enabled: false,
            reason: 'invalid-profile',
            profile: 'invalid',
            configurationValid: false,
            rawProfile: 'turbo',
        });

        const runtime = createInfraRuntime({
            runtimeId: 'invalid-l2-health-test',
            env: process.env,
            sqliteProvider: createBetterSqliteProvider(() => /** @type {import('better-sqlite3').Database} */ (testDb)),
        });
        try {
            expect(readIoRuntimeHealthSnapshot(runtime).alerts).toContainEqual(
                expect.objectContaining({
                    code: 'IO_L2_PROFILE_INVALID',
                    severity: 'high',
                }),
            );
        } finally {
            await runtime.dispose();
        }
    });
});
