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
    formatTerminalIsoTimestamp: vi.fn((/** @type {unknown} */ value) =>
        new Date(Number(value)).toISOString().replace(/\.\d{3}Z$/u, '+00:00'),
    ),
    formatTerminalRelativeAge: vi.fn(
        (/** @type {unknown} */ value) => `há ${Math.max(0, Math.floor((1710000005000 - Number(value)) / 1000))}s`,
    ),
    formatTerminalTimeLabel: vi.fn(
        (/** @type {unknown} */ value) =>
            `${new Date(Number(value)).toISOString().replace(/\.\d{3}Z$/u, '+00:00')} (há ${Math.max(0, Math.floor((1710000005000 - Number(value)) / 1000))}s)`,
    ),
    readTerminalSseEventArchiveTail,
    terminalThemeHeadline: vi.fn((/** @type {string} */ _role, /** @type {string} */ title) => `  ${title}`),
    terminalThemeRow: vi.fn(
        (/** @type {string} */ label, /** @type {string} */ value) => `  ${label.padEnd(12)} ${value}`,
    ),
    terminalThemeText: vi.fn((/** @type {string} */ _role, /** @type {string} */ text) => text),
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
        expect(ctx.output()).toContain('Fontes do Terminal');
        expect(ctx.output()).toContain('5 eventos recentes');
        expect(ctx.output()).toContain('Streaming');
        expect(ctx.output()).toContain('1 recentes');
        expect(ctx.output()).toContain('/events delta 50');
        expect(ctx.output()).toContain('/events source terminal/dialog/turn-display.createDeltaCallback 50');
        expect(ctx.output()).toContain('Pergunta ao operador');
        expect(ctx.output()).toContain('Configuração BYOK');
        expect(ctx.output()).toContain('/events sources detail');
        expect(ctx.output()).not.toContain('task.delta only when dialog loop is inactive');
        expect(ctx.output()).not.toContain('COPILOT_BYOK_* resolved into SDK provider');
    });

    it('preserva mapa técnico de fontes no modo detail', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, 'sources detail 50');

        expect(ctx.output()).toContain('Fontes do Terminal - Detalhe');
        expect(ctx.output()).toContain('assistant.text.delta');
        expect(ctx.output()).toContain('task.delta only when dialog loop is inactive');
        expect(ctx.output()).toContain('COPILOT_BYOK_* resolved into SDK provider');
        expect(ctx.output()).toContain('/byok env · /byok profiles · /byok models refresh · /status');
    });

    it('aceita filtros humanos sem sinal de igual', async () => {
        const ctx = mockCtx();

        await cmdEvents(
            { println: ctx.println },
            '12 source sdk tool call_123 request req-123 hub hub-1 trace turn:abc',
        );

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
        expect(ctx.output()).toContain('últimas 5');
        expect(ctx.output()).toContain('Registro');
        expect(ctx.output()).not.toContain('Archive');
        expect(ctx.output()).toContain('/events --raw');
        expect(ctx.output()).toContain('#42');
        expect(ctx.output()).toContain('Streaming');
        expect(ctx.output()).toContain('DELTA-CANONICAL-1');
        expect(ctx.output()).not.toContain('call=call_123');
        expect(ctx.output()).not.toContain('req=req-123');
    });

    it('humaniza eventos de conversa e boot no resumo default', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 3,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 10,
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
                    eventId: 1,
                    event: 'dialog.loop.changed',
                    source: 'terminal-agent-wiring/dialog.loop.changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: { active: true },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 2,
                    event: 'terminal.runtime.wired',
                    source: 'terminal/runtime-root.runtime-config',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { phase: 'runtime-config' },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 3,
                    event: 'quota.warning',
                    source: 'agent/passthrough/quota.warning',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { quotaId: 'premium_interactions' },
                },
                {
                    timestamp: 1710000003000,
                    eventId: 4,
                    event: 'session.model_changed',
                    source: 'sdk/session.model_changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { previousModel: 'auto', newModel: 'gpt-4.1-mini', reasoningEffort: 'high' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '10');

        expect(ctx.output()).toContain('Conversa alterada');
        expect(ctx.output()).toContain('há 5s');
        expect(ctx.output()).toContain('Runtime pronto');
        expect(ctx.output()).toContain('Aviso de quota');
        expect(ctx.output()).toContain('Modelo alterado');
        expect(ctx.output()).toContain('modelo auto → gpt-4.1-mini · raciocínio high');
        expect(ctx.output()).toContain('2024-03-09T16:00:00+00:00 (há 5s)');
        expect(ctx.output()).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}/u);
        expect(ctx.output()).not.toContain('dialog loop changed');
        expect(ctx.output()).not.toContain('terminal runtime wired');
        expect(ctx.output()).not.toContain('quota warning');
        expect(ctx.output()).not.toContain('session model changed');
    });

    it('humaniza perguntas, raciocínio e tarefas em segundo plano no resumo default', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 4,
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
                    eventId: 10,
                    event: 'assistant.reasoning_complete',
                    source: 'sdk/assistant.reasoning_complete',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: { contentLength: 840 },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 11,
                    event: 'question.answered',
                    source: 'agent',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: { questionId: 'q-1' },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 12,
                    event: 'agent.background.completed',
                    source: 'agent/background.completed',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: { status: 'completed' },
                },
                {
                    timestamp: 1710000003000,
                    eventId: 13,
                    event: 'agent.background.idle',
                    source: 'agent/background.idle',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: {},
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('Raciocínio concluído');
        expect(ctx.output()).toContain('Resposta do operador');
        expect(ctx.output()).toContain('Tarefa em segundo plano concluída');
        expect(ctx.output()).toContain('Tarefa em segundo plano ociosa');
        expect(ctx.output()).toContain('tarefa em segundo plano');
        expect(ctx.output()).not.toContain('assistant reasoning complete');
        expect(ctx.output()).not.toContain('question answered');
        expect(ctx.output()).not.toContain('Tarefa em background concluída');
        expect(ctx.output()).not.toContain('Background ocioso');
        expect(ctx.output()).not.toContain('agente/background');
    });

    it('humaniza eventos de I/O local sem tratar type como estado', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 12,
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
                    eventId: 31,
                    event: 'tool.lifecycle',
                    source: 'io',
                    eventSource: 'io',
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        type: 'io_op',
                        toolName: 'io.search',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '12');

        expect(ctx.output()).toContain('I/O local');
        expect(ctx.output()).toContain('ferramenta Busca local');
        expect(ctx.output()).toContain('tipo I/O local');
        expect(ctx.output()).not.toContain('estado io op');
        expect(ctx.output()).not.toContain('io_op');
    });

    it('humaniza tipos e classificações internas em eventos operacionais', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 2,
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
                    eventId: 51,
                    event: 'sdk.lifecycle',
                    source: 'agent/sdk.lifecycle',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { type: 'session.updated' },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 52,
                    event: 'llm.usage',
                    source: 'agent/llm.usage',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { classification: 'ask_user_continuation' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('tipo sessão atualizada');
        expect(ctx.output()).toContain('tipo continuação da pergunta humana');
        expect(ctx.output()).not.toContain('tipo session.updated');
        expect(ctx.output()).not.toContain('ask user continuation');
        expect(ctx.output()).not.toContain('ask_user_continuation');
    });

    it('agrega eventos default repetidos sem alterar consultas diagnosticas', async () => {
        const repeated = [0, 1, 2].map((offset) => ({
            timestamp: 1710000000000 + offset * 1000,
            eventId: 70 + offset,
            event: 'tool.lifecycle',
            source: 'io',
            eventSource: 'io',
            traceId: null,
            turnId: null,
            hubSessionId: null,
            payload: {
                type: 'io_op',
                toolName: 'io.read',
            },
        }));
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: repeated.length,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 12,
                event: null,
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: repeated,
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '12');

        expect(ctx.output()).toContain('×3');
        expect((ctx.output().match(/Ferramenta/g) ?? [])).toHaveLength(1);
        expect(ctx.output()).toContain('ferramenta Leitura local');
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
        expect(ctx.output()).toContain('transcript LLM-B · registro export LLM-B via SDK');
        expect(ctx.output()).toContain('transcript Sistema/pergunta ao operador · registro export pergunta ao operador');
        expect(ctx.output()).toContain('transcript Operador/resposta · registro export pergunta ao operador');
        expect(ctx.output()).not.toContain('rastreamento turn:1');
        expect(ctx.output()).not.toContain('turno 1');
        expect(ctx.output()).not.toContain('ask_user');
        expect(ctx.output()).not.toContain('trace=');
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
