// @ts-check

import { createBetterSqliteProvider } from '#copilot/infra/internal/database/sqlite/better-sqlite3';
import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** @type {ReturnType<typeof createInfraRuntime>[]} */
const runtimes = [];

function createTestRuntime(options = {}) {
    const runtime = createInfraRuntime({
        runtimeId: `invalidation-test-${Date.now()}-${Math.random()}`,
        env: process.env,
        ...options,
    });
    runtimes.push(runtime);
    return runtime;
}

afterEach(async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.dispose()));
    vi.unstubAllEnvs();
});

describe('infra/filesystem/invalidation bus runtime ownership', () => {
    it('publica evento normalizado para hooks registrados', () => {
        const runtime = createTestRuntime();
        /** @type {{ filePath: string; recursive: boolean; source: string }[]} */
        const seen = [];
        const unregister = runtime.coherence.invalidation.registerHook((filePath, event) => {
            seen.push({ filePath, recursive: event.recursive, source: event.source });
        });

        runtime.coherence.invalidation.publish('/tmp/a.txt', { recursive: true, source: 'test' });
        unregister();

        expect(seen).toEqual([{ filePath: '/tmp/a.txt', recursive: true, source: 'test' }]);
    });

    it('expõe invalidation recém-despachada apenas como hint de deduplicação da própria instância', () => {
        const first = createTestRuntime();
        const second = createTestRuntime();
        first.coherence.invalidation.publish('/tmp/recent.txt', { source: 'canonical-test' });

        const recent = first.coherence.invalidation.recent('/tmp/recent.txt');
        expect(recent?.source).toBe('canonical-test');
        expect(typeof recent?.atMs).toBe('number');
        expect(first.coherence.invalidation.recent('/tmp/missing.txt')).toBeNull();
        expect(second.coherence.invalidation.recent('/tmp/recent.txt')).toBeNull();
    });

    it('unregister remove hook sem afetar publicações posteriores', () => {
        const runtime = createTestRuntime();
        let calls = 0;
        const unregister = runtime.coherence.invalidation.registerHook(() => {
            calls += 1;
        });

        runtime.coherence.invalidation.publish('/tmp/a.txt');
        unregister();
        runtime.coherence.invalidation.publish('/tmp/b.txt');

        expect(calls).toBe(1);
    });

    it('derived caches são lazy e o journal materializa após configuração tardia do binding SQLite', () => {
        vi.stubEnv('IO_INVALIDATION_DEBOUNCE_MS', '0');
        vi.stubEnv('IO_CROSS_PROCESS_INVALIDATION_ENABLED', '1');
        vi.stubEnv('IO_CROSS_PROCESS_INVALIDATION_POLL_MS', '25');
        const runtime = createTestRuntime();

        const before = runtime.coherence.invalidation.snapshot();
        runtime.coherence.read.byteLineIndex.ensureInvalidationHook();
        const beforeComposition = runtime.coherence.invalidation.snapshot();
        const db = new Database(':memory:');
        runtime.database.configure(createBetterSqliteProvider(() => db));
        runtime.coherence.invalidation.publish('/tmp/retry-after-composition.js', { source: 'retry-proof' });
        const afterComposition = runtime.coherence.invalidation.snapshot();

        expect(before).toMatchObject({ hooks: 0 });
        expect(before.crossProcess).toMatchObject({ initialized: false, initializationErrors: 0 });
        expect(beforeComposition).toMatchObject({ hooks: 1 });
        expect(beforeComposition.crossProcess).toMatchObject({ initialized: false, initializationErrors: 0 });
        expect(afterComposition.crossProcess).toMatchObject({
            initialized: true,
            initializationErrors: 0,
            published: 1,
        });
        db.close();
    });

    it('despacha localmente antes de debouncar a replicação da própria instância', () => {
        vi.stubEnv('IO_INVALIDATION_DEBOUNCE_MS', '1000');
        vi.stubEnv('IO_CROSS_PROCESS_INVALIDATION_ENABLED', '0');
        const runtime = createTestRuntime();
        /** @type {{filePath:string;source:string}[]} */
        const seen = [];
        runtime.coherence.invalidation.registerHook((filePath, event) => seen.push({ filePath, source: event.source }));

        runtime.coherence.invalidation.publish('/tmp/deferred-replication.js', { source: 'runtime-test' });
        const before = runtime.coherence.invalidation.snapshot();
        runtime.coherence.invalidation.flush();
        const after = runtime.coherence.invalidation.snapshot();

        expect(seen).toEqual([{ filePath: '/tmp/deferred-replication.js', source: 'runtime-test' }]);
        expect(before).toMatchObject({
            localDispatches: 1,
            pending: 1,
            pendingReplications: 1,
            replicationQueued: 1,
            replicationFlushes: 0,
        });
        expect(after).toMatchObject({
            localDispatches: 1,
            pending: 0,
            pendingReplications: 0,
            replicationFlushes: 1,
        });
    });
});
