// @ts-check

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

const writerMocks = vi.hoisted(() => {
    /** @type {{
    options: Record<string, unknown>;
    enqueueLine: import('vitest').Mock;
    flush: import('vitest').Mock;
}[]} */
    const instances = [];
    const createBoundJsonlFileWriter = vi.fn((options) => {
        const instance = {
            options,
            enqueueLine: vi.fn(),
            flush: vi.fn(async () => undefined),
            getState: vi.fn(() => ({ queueDepth: 0 })),
        };
        instances.push(instance);
        return instance;
    });
    return { createBoundJsonlFileWriter, instances };
});

vi.mock('#copilot/infra/public/persistence/jsonl', async (importOriginal) => ({
    .../** @type {Record<string, unknown>} */ (await importOriginal()),
    createBoundJsonlFileWriter: writerMocks.createBoundJsonlFileWriter,
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

describe('observability/event-collector redaction', () => {
    beforeEach(() => {
        writerMocks.instances.length = 0;
        vi.clearAllMocks();
    });

    afterEach(() => {
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

        const writer = writerMocks.instances.find((instance) =>
            String(instance.options['filePath'] ?? '').endsWith('/events.jsonl'),
        );
        assert.ok(writer, 'event collector must construct the canonical JSONL writer');
        assert.equal(writer.enqueueLine.mock.calls.length, 1);
        const persisted = String(writer.enqueueLine.mock.calls[0]?.[0] ?? '');
        assert.equal(persisted.includes(githubToken), false);
        assert.equal(persisted.includes(byokToken), false);
        assert.match(persisted, /\[redacted\]/);
        assert.match(persisted, /"type":"session.error"/);
    });

    it('encaminha eventos sucessivos para a mesma fila sem recriar a primitive de persistência', async () => {
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
        handlers['session.error']?.[0]?.({ type: 'session.error', data: { message: 'second' } });

        const eventWriters = writerMocks.instances.filter((instance) =>
            String(instance.options['filePath'] ?? '').endsWith('/events.jsonl'),
        );
        assert.equal(eventWriters.length, 1);
        const writer = eventWriters[0];
        assert.ok(writer);
        assert.equal(writer.enqueueLine.mock.calls.length, 2);
        assert.match(String(writer.enqueueLine.mock.calls[0]?.[0] ?? ''), /first/);
        assert.match(String(writer.enqueueLine.mock.calls[1]?.[0] ?? ''), /second/);
    });
});
