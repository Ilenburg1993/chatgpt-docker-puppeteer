// @ts-check

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
    getRecentIoInvalidation,
    publishIoInvalidation,
    registerIoInvalidationHook,
} from '#copilot/infra/internal/filesystem/invalidation';

import { resetIoInvalidationBusForTest } from '#copilot/infra/public/testing';
const execFileAsync = promisify(execFile);
const INVALIDATION_BUS_MODULE_URL = new URL(
    '../../../../src/copilot/infra/filesystem/invalidation/index.js',
    import.meta.url,
).href;
const READ_CHUNKS_MODULE_URL = new URL('../../../../src/copilot/infra/filesystem/read/chunks/index.js', import.meta.url)
    .href;
const BYTE_LINE_INDEX_MODULE_URL = new URL(
    '../../../../src/copilot/infra/filesystem/read/line-index/index.js',
    import.meta.url,
).href;
const LINE_OFFSET_MODULE_URL = new URL('../../../../src/copilot/infra/filesystem/read/cache/index.js', import.meta.url)
    .href;
const REPO_READ_CACHE_MODULE_URL = new URL('../../../../src/copilot/mcp/tools/repo-read-cache.js', import.meta.url)
    .href;
const SQLITE_PORT_MODULE_URL = new URL('../../../../src/copilot/infra/database/index.js', import.meta.url).href;
const INFRA_TESTING_MODULE_URL = new URL('../../../../src/copilot/infra/testing/index.js', import.meta.url).href;

afterEach(() => {
    resetIoInvalidationBusForTest();
});

describe('infra/filesystem/invalidation bus', () => {
    it('publica evento normalizado para hooks registrados', () => {
        /** @type {{ filePath: string; recursive: boolean; source: string }[]} */
        const seen = [];
        const unregister = registerIoInvalidationHook((filePath, event) => {
            seen.push({ filePath, recursive: event.recursive, source: event.source });
        });

        publishIoInvalidation('/tmp/a.txt', { recursive: true, source: 'test' });
        unregister();

        expect(seen).toEqual([{ filePath: '/tmp/a.txt', recursive: true, source: 'test' }]);
    });

    it('expõe invalidation recém-despachada apenas como hint de deduplicação', () => {
        publishIoInvalidation('/tmp/recent.txt', { source: 'canonical-test' });
        const recent = getRecentIoInvalidation('/tmp/recent.txt');

        expect(recent?.source).toBe('canonical-test');
        expect(typeof recent?.atMs).toBe('number');
        expect(getRecentIoInvalidation('/tmp/missing.txt')).toBeNull();
    });

    it('unregister remove hook sem afetar publicações posteriores', () => {
        let calls = 0;
        const unregister = registerIoInvalidationHook(() => {
            calls += 1;
        });

        publishIoInvalidation('/tmp/a.txt');
        unregister();
        publishIoInvalidation('/tmp/b.txt');

        expect(calls).toBe(1);
    });

    it('imports de caches são side-effect free e o journal faz retry após composição tardia do SQLite', async () => {
        const script = `
            const [
                { default: Database },
                _chunks,
                byteLineIndex,
                _lineOffsets,
                _repoReadCache,
                bus,
                sqlitePort,
                testing,
            ] = await Promise.all([
                import('better-sqlite3'),
                import(${JSON.stringify(READ_CHUNKS_MODULE_URL)}),
                import(${JSON.stringify(BYTE_LINE_INDEX_MODULE_URL)}),
                import(${JSON.stringify(LINE_OFFSET_MODULE_URL)}),
                import(${JSON.stringify(REPO_READ_CACHE_MODULE_URL)}),
                import(${JSON.stringify(INVALIDATION_BUS_MODULE_URL)}),
                import(${JSON.stringify(SQLITE_PORT_MODULE_URL)}),
                import(${JSON.stringify(INFRA_TESTING_MODULE_URL)}),
            ]);
            const before = bus.getIoInvalidationBusStats();
            byteLineIndex.ensureByteLineIndexInvalidationHook();
            const beforeComposition = bus.getIoInvalidationBusStats();
            const db = new Database(':memory:');
            sqlitePort.configureInfraSqliteProvider(() => db);
            bus.publishIoInvalidation('/tmp/retry-after-composition.js', { source: 'retry-proof' });
            const afterComposition = bus.getIoInvalidationBusStats();
            testing.resetIoInvalidationBusForTest();
            testing.resetInfraSqliteProviderForTest();
            db.close();
            console.log(JSON.stringify({ before, beforeComposition, afterComposition }));
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            env: {
                ...process.env,
                NODE_ENV: 'production',
                VITEST: 'false',
                IO_INVALIDATION_DEBOUNCE_MS: '0',
                IO_CROSS_PROCESS_INVALIDATION_ENABLED: '1',
                IO_CROSS_PROCESS_INVALIDATION_POLL_MS: '25',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const result = JSON.parse(stdout.trim());

        expect(result.before).toMatchObject({ hooks: 0 });
        expect(result.before.crossProcess).toMatchObject({ initialized: false, initializationErrors: 0 });
        expect(result.beforeComposition).toMatchObject({ hooks: 1 });
        expect(result.beforeComposition.crossProcess).toMatchObject({ initialized: false, initializationErrors: 0 });
        expect(result.afterComposition.crossProcess).toMatchObject({
            initialized: true,
            initializationErrors: 0,
            published: 1,
        });
    });

    it('despacha localmente antes de debouncar a replicação cross-process', async () => {
        const script = `
            import {
                flushIoInvalidationQueue,
                getIoInvalidationBusStats,
                publishIoInvalidation,
                registerIoInvalidationHook,
            } from ${JSON.stringify(INVALIDATION_BUS_MODULE_URL)};
            import { resetIoInvalidationBusForTest } from ${JSON.stringify(INFRA_TESTING_MODULE_URL)};
            const seen = [];
            registerIoInvalidationHook((filePath, event) => seen.push({ filePath, source: event.source }));
            publishIoInvalidation('/tmp/deferred-replication.js', { source: 'child-test' });
            const before = getIoInvalidationBusStats();
            flushIoInvalidationQueue();
            const after = getIoInvalidationBusStats();
            resetIoInvalidationBusForTest();
            console.log(JSON.stringify({ seen, before, after }));
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            env: {
                ...process.env,
                NODE_ENV: 'production',
                VITEST: 'false',
                IO_INVALIDATION_DEBOUNCE_MS: '1000',
                IO_CROSS_PROCESS_INVALIDATION_ENABLED: '0',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const result = JSON.parse(stdout.trim());

        expect(result.seen).toEqual([{ filePath: '/tmp/deferred-replication.js', source: 'child-test' }]);
        expect(result.before).toMatchObject({
            localDispatches: 1,
            pending: 1,
            pendingReplications: 1,
            replicationQueued: 1,
            replicationFlushes: 0,
        });
        expect(result.after).toMatchObject({
            localDispatches: 1,
            pending: 0,
            pendingReplications: 0,
            replicationFlushes: 1,
        });
    });
});
