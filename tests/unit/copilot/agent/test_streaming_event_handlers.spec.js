// @ts-check

import { describe, expect, it, vi } from 'vitest';

function createMockSession() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();

    return {
        /** @param {string} event @param {Function} handler */
        on(event, handler) {
            const arr = listeners.get(event) ?? [];
            arr.push(handler);
            listeners.set(event, arr);
            return () => {
                const current = listeners.get(event) ?? [];
                const idx = current.indexOf(handler);
                if (idx >= 0) current.splice(idx, 1);
            };
        },
        /** @param {string} event @param {Record<string, unknown>} [data] */
        _emit(event, data = {}) {
            const evtObj = { type: event, kind: event, timestamp: Date.now(), data };
            for (const fn of listeners.get(event) ?? []) {
                fn(evtObj);
            }
        },
    };
}

describe('event-handlers/streaming', () => {
    it('wireStreamingEvents retorna unsubscribe functions', async () => {
        const { wireStreamingEvents } = await import('#copilot/event-handlers/streaming');
        const session = createMockSession();
        const unsubs = wireStreamingEvents(/** @type {any} */ (session), {
            emit: vi.fn(),
            isProcessing: () => false,
            dialogLoopActive: () => false,
        });
        expect(unsubs).toHaveLength(4);
        unsubs.forEach((u) => expect(typeof u).toBe('function'));
    });

    it('emite assistant.streaming_delta com totalResponseSizeBytes', async () => {
        const { wireStreamingEvents } = await import('#copilot/event-handlers/streaming');
        const session = createMockSession();
        const emit = vi.fn();

        wireStreamingEvents(/** @type {any} */ (session), {
            emit,
            isProcessing: () => false,
            dialogLoopActive: () => false,
        });

        session._emit('assistant.streaming_delta', { totalResponseSizeBytes: 8192 });

        expect(emit).toHaveBeenCalledWith(
            'assistant.streaming_delta',
            expect.objectContaining({ totalResponseSizeBytes: 8192 }),
        );
    });

    it('emite dialog.delta quando dialogLoopActive=true', async () => {
        const { wireStreamingEvents } = await import('#copilot/event-handlers/streaming');
        const session = createMockSession();
        const emit = vi.fn();

        wireStreamingEvents(/** @type {any} */ (session), {
            emit,
            isProcessing: () => false,
            dialogLoopActive: () => true,
        });

        session._emit('assistant.message_delta', { deltaContent: 'abc' });

        expect(emit).toHaveBeenCalledWith('dialog.delta', { chunk: 'abc' });
    });

    it('emite task.delta quando dialogLoopActive=false e não está processing', async () => {
        const { wireStreamingEvents } = await import('#copilot/event-handlers/streaming');
        const session = createMockSession();
        const emit = vi.fn();

        wireStreamingEvents(/** @type {any} */ (session), {
            emit,
            isProcessing: () => false,
            dialogLoopActive: () => false,
        });

        session._emit('assistant.message_delta', { deltaContent: 'abc' });

        expect(emit).toHaveBeenCalledWith('task.delta', { taskId: null, chunk: 'abc' });
    });

    it('deduplica o mesmo assistant.message_delta quando a sessão foi wireada duas vezes', async () => {
        const { wireStreamingEvents } = await import('#copilot/event-handlers/streaming');
        const session = createMockSession();
        const emit = vi.fn();

        wireStreamingEvents(/** @type {any} */ (session), {
            emit,
            isProcessing: () => false,
            dialogLoopActive: () => true,
        });
        wireStreamingEvents(/** @type {any} */ (session), {
            emit,
            isProcessing: () => false,
            dialogLoopActive: () => true,
        });

        session._emit('assistant.message_delta', { deltaContent: 'abc' });

        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('dialog.delta', { chunk: 'abc' });
    });
});
