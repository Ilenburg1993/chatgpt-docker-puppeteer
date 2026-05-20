// @ts-check

import { describe, expect, it, vi } from 'vitest';

const readTerminalSseEventArchiveTail = vi.fn(async () => ({
    state: {
        path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
        events: 2,
        queueDepth: 0,
        error: null,
    },
    filters: {
        limit: 5,
        event: 'delta',
        traceId: 'turn:abc',
        turnId: null,
        source: null,
    },
    entries: [
        {
            timestamp: 1710000000000,
            eventId: 42,
            event: 'delta',
            source: 'terminal-dialog/delta',
            eventSource: null,
            traceId: 'turn:abc',
            turnId: 'turn-1',
            payload: {
                content: 'DELTA-CANONICAL-1',
            },
        },
    ],
}));

vi.mock('../../../../src/copilot/terminal/state/index.js', () => ({
    readTerminalSseEventArchiveTail,
}));

const { cmdEvents } = await import('../../../../src/copilot/terminal/commands/events.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/events', () => {
    it('consulta archive SSE com filtros de evento e trace', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '5 event=delta trace=turn:abc');

        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 5, event: 'delta', traceId: 'turn:abc' }),
        );
        expect(ctx.output()).toContain('Eventos SSE');
        expect(ctx.output()).toContain('#42');
        expect(ctx.output()).toContain('DELTA-CANONICAL-1');
    });

    it('mostra vazio quando archive nao tem entradas', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: { path: null, events: 0, queueDepth: 0, error: null },
            filters: { limit: 20, event: null, traceId: null, turnId: null, source: null },
            entries: [],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '');

        expect(ctx.output()).toContain('Nenhum evento encontrado');
    });
});
