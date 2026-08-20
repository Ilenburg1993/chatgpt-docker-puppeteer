// @ts-check

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
    getRecentIoInvalidation,
    publishIoInvalidation,
    registerIoInvalidationHook,
    resetIoInvalidationBusForTest,
} from '../../../../src/copilot/infra/io/invalidation/bus.js';

const execFileAsync = promisify(execFile);
const INVALIDATION_BUS_MODULE_URL = new URL('../../../../src/copilot/infra/io/invalidation/bus.js', import.meta.url)
    .href;

afterEach(() => {
    resetIoInvalidationBusForTest();
});

describe('infra/io/invalidation bus', () => {
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

    it('despacha localmente antes de debouncar a replicação cross-process', async () => {
        const script = `
            import {
                flushIoInvalidationQueue,
                getIoInvalidationBusStats,
                publishIoInvalidation,
                registerIoInvalidationHook,
                resetIoInvalidationBusForTest,
            } from ${JSON.stringify(INVALIDATION_BUS_MODULE_URL)};
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
