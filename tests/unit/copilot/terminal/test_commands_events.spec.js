// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

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
        toolCallId: null,
        requestId: null,
        hubSessionId: null,
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
            hubSessionId: 'hub-1',
            payload: {
                toolCallId: 'call_123',
                requestId: 'req-123',
                content: 'DELTA-CANONICAL-1',
            },
        },
    ],
}));

vi.mock('../../../../src/copilot/terminal/state/index.js', () => ({
    formatTerminalIsoTimestamp: vi.fn((/** @type {unknown} */ value) => new Date(Number(value)).toISOString()),
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
    it('mostra mapa de fontes canônicas com contagem recente do archive SSE', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, 'sources 50');

        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 50, event: null, source: null }),
        );
        expect(ctx.output()).toContain('Fontes canônicas do terminal');
        expect(ctx.output()).toContain('janela últimos 5 eventos');
        expect(ctx.output()).toContain('assistant.text.delta');
        expect(ctx.output()).toContain('recentes 1');
        expect(ctx.output()).toContain('/events delta 50');
        expect(ctx.output()).toContain('/events source terminal/dialog/turn-display.createDeltaCallback 50');
        expect(ctx.output()).toContain('task.delta only when dialog loop is inactive');
        expect(ctx.output()).toContain('ask_user.visible-question');
        expect(ctx.output()).toContain('byok.provider.config');
        expect(ctx.output()).toContain('COPILOT_BYOK_* resolved into SDK provider');
        expect(ctx.output()).toContain('/byok env · /byok profiles · /byok models refresh · /status');
    });

    it('aceita filtros humanos sem sinal de igual', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '12 source sdk tool call_123 request req-123 hub hub-1 trace turn:abc');

        expect(readTerminalSseEventArchiveTail).toHaveBeenLastCalledWith(
            expect.objectContaining({
                limit: 12,
                source: 'sdk',
                toolCallId: 'call_123',
                requestId: 'req-123',
                hubSessionId: 'hub-1',
                traceId: 'turn:abc',
            }),
        );
        expect(ctx.output()).not.toContain('source=sdk');
    });

    it('consulta archive SSE com filtros de evento e trace', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '5 event=delta trace=turn:abc');

        expect(readTerminalSseEventArchiveTail).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 5, event: 'delta', traceId: 'turn:abc' }),
        );
        expect(ctx.output()).toContain('Eventos SSE');
        expect(ctx.output()).toContain('visão resumida');
        expect(ctx.output()).toContain('/events --raw');
        expect(ctx.output()).toContain('#42');
        expect(ctx.output()).toContain('Streaming');
        expect(ctx.output()).toContain('DELTA-CANONICAL-1');
        expect(ctx.output()).not.toContain('call=call_123');
        expect(ctx.output()).not.toContain('req=req-123');
    });

    it('consulta por tool call, request e hub session', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 2,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 12,
                event: null,
                traceId: null,
                turnId: null,
                source: 'sdk',
                toolCallId: 'call_123',
                requestId: 'req-123',
                hubSessionId: 'hub-1',
            },
            entries: [
                {
                    timestamp: 1710000000000,
                    eventId: 42,
                    event: 'tool.lifecycle',
                    source: 'sdk',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        toolCallId: 'call_123',
                        requestId: 'req-123',
                        toolName: 'read_file_content',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '12 tool=call_123 request=req-123 hub=hub-1 source=sdk');

        expect(readTerminalSseEventArchiveTail).toHaveBeenLastCalledWith(
            expect.objectContaining({
                limit: 12,
                toolCallId: 'call_123',
                requestId: 'req-123',
                hubSessionId: 'hub-1',
                source: 'sdk',
            }),
        );
        expect(ctx.output()).toContain('tool call_123');
        expect(ctx.output()).toContain('request req-123');
        expect(ctx.output()).toContain('hub hub-1');
        expect(ctx.output()).not.toContain('tool=call_123');
        expect(ctx.output()).toContain('Ferramenta');
        expect(ctx.output()).toContain('ferramenta Ler arquivo');
        expect(ctx.output()).toContain('call call_123');
        expect(ctx.output()).toContain('req req-123');
        expect(ctx.output()).not.toContain('tool=Ler arquivo');
        expect(ctx.output()).not.toContain('tool=read_file_content');
    });

    it('mostra vínculo compacto entre eventos canônicos e transcript/export', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 3,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 20,
                event: null,
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: [
                {
                    timestamp: 1710000000000,
                    eventId: 187,
                    event: 'assistant.message',
                    source: 'sdk/assistant.message',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: null,
                    payload: {
                        content: 'DELTA-CANONICAL-8',
                    },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 204,
                    event: 'user_input.requested',
                    source: 'sdk/user_input.requested',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: null,
                    payload: {
                        requestId: 'ask-1',
                        question: 'ASK-CANONICAL: responda SIM para fechar o teste',
                    },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 213,
                    event: 'user_input.completed',
                    source: 'sdk/user_input.completed',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: null,
                    payload: {
                        requestId: 'ask-1',
                        content: 'SIM',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('Mensagem da LLM-B');
        expect(ctx.output()).toContain('Pergunta ao operador');
        expect(ctx.output()).toContain('Resposta do operador');
        expect(ctx.output()).toContain('transcript LLM-B · export envelope:sdk/assistant.message trace=turn:1 turn=1');
        expect(ctx.output()).toContain(
            'transcript Sistema/ask_user · export envelope:sdk/user_input.requested trace=turn:1 turn=1',
        );
        expect(ctx.output()).toContain(
            'transcript Usuário/ask_user · export envelope:sdk/user_input.completed trace=turn:1 turn=1',
        );
    });

    it('normaliza quebras internas no resumo humano sem afetar raw/json', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 20,
                event: null,
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: [
                {
                    timestamp: 1710000000000,
                    eventId: 301,
                    event: 'assistant.message',
                    source: 'sdk/assistant.message',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: null,
                    payload: {
                        content: 'linha 1\nlinha 2\r\nlinha 3',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('linha 1 linha 2 linha 3');
        expect(ctx.output()).not.toContain('linha 1\nlinha 2');
    });

    it('emite JSON estruturado para automacao', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '3 --json event=delta');

        const parsed = JSON.parse(ctx.output());
        expect(parsed.filters).toMatchObject({ limit: 5, event: 'delta' });
        expect(parsed.entries[0]).toMatchObject({ eventId: 42, event: 'delta' });
    });

    it('emite JSONL raw para comparacao com artefatos SSE', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '3 --raw event=delta');

        const lines = ctx.output().trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({ eventId: 42, event: 'delta' });
    });

    it('mostra vazio quando archive nao tem entradas', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: { path: null, events: 0, queueDepth: 0, error: null },
            filters: {
                limit: 20,
                event: null,
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: [],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '');

        expect(ctx.output()).toContain('Nenhum evento encontrado');
    });
});
