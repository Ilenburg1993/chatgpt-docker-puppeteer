// @ts-check

import { afterEach, describe, expect, it } from 'vitest';

import {
    getRecentIoInvalidation,
    publishIoInvalidation,
    registerIoInvalidationHook,
    resetIoInvalidationBusForTest,
} from '../../../../src/copilot/infra/io/invalidation/bus.js';

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
});
