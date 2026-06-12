// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
    appendFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 0 })),
}));

vi.mock('node:fs/promises', () => fsMocks);

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

describe('observability/event-collector redaction', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('redige segredos antes de persistir events.jsonl', async () => {
        const { createEventCollector } = await import('../../../../src/copilot/observability/event-collector.js');
        /** @type {Record<string, ((event: any) => void)[]>} */
        const handlers = {};
        const session = {
            on: (/** @type {string} */ type, /** @type {(event: any) => void} */ handler) => {
                (handlers[type] ??= []).push(handler);
                return () => {};
            },
        };
        const collector = createEventCollector({
            persist: true,
            persistTypes: ['session.error'],
        });
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';

        collector.attach(/** @type {any} */ (session), 'sdk-redaction');
        handlers['session.error']?.[0]?.({
            type: 'session.error',
            timestamp: '2026-06-08T09:42:00.000Z',
            data: {
                errorType: 'provider',
                message: {
                    message: `gitHubToken=${githubToken} Authorization: Bearer ${byokToken}`,
                },
            },
        });

        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(fsMocks.appendFile.mock.calls.length, 1);
        const persisted = String(fsMocks.appendFile.mock.calls[0]?.[1] ?? '');
        assert.equal(persisted.includes(githubToken), false);
        assert.equal(persisted.includes(byokToken), false);
        assert.match(persisted, /\[redacted\]/);
        assert.match(persisted, /"type":"session.error"/);
    });

    it('não sobrepõe ciclos de flush enquanto um append está em voo', async () => {
        let releaseFirst = () => {};
        fsMocks.appendFile.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirst = resolve;
                }),
        );
        const { createEventCollector } = await import('../../../../src/copilot/observability/event-collector.js');
        /** @type {Record<string, ((event: any) => void)[]>} */
        const handlers = {};
        const session = {
            on: (/** @type {string} */ type, /** @type {(event: any) => void} */ handler) => {
                (handlers[type] ??= []).push(handler);
                return () => {};
            },
        };
        createEventCollector({ persist: true, persistTypes: ['session.error'] }).attach(
            /** @type {any} */ (session),
            'sdk-serialized',
        );

        handlers['session.error']?.[0]?.({ type: 'session.error', data: { message: 'first' } });
        await vi.waitFor(() => assert.equal(fsMocks.appendFile.mock.calls.length, 1));
        handlers['session.error']?.[0]?.({ type: 'session.error', data: { message: 'second' } });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(fsMocks.appendFile.mock.calls.length, 1);

        releaseFirst();
        await vi.waitFor(() => assert.equal(fsMocks.appendFile.mock.calls.length, 2));
    });
});
