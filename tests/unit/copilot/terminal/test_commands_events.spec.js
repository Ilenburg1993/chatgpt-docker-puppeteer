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
            `${new Date(Number(value)).toISOString().replace(/Z$/u, '+00:00')} (há ${Math.max(0, Math.floor((1710000005000 - Number(value)) / 1000))}s)`,
    ),
    readTerminalSseEventArchiveTail,
    terminalThemeHeadline: vi.fn((/** @type {string} */ _role, /** @type {string} */ title) => `  ${title}`),
    terminalThemeRow: vi.fn(
        (/** @type {string} */ label, /** @type {string} */ value) => `  ${label.padEnd(12)} ${value}`,
    ),
    terminalThemeWrappedRow: vi.fn(
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
        expect(ctx.output()).toContain('ver Streaming: /events 50');
        expect(ctx.output()).not.toContain('detalhe técnico: /events sources detail');
        expect(ctx.output()).toContain('/events --json compact · /events --raw preview · /events --raw full');
        expect(ctx.output()).toContain('payload público redigido; compacto usa preview e ids de filtro');
        expect(ctx.output()).toContain('Pergunta ao operador');
        expect(ctx.output()).toContain('Configuração BYOK');
        expect(ctx.output()).toContain('Canvas aberto + Canvas disponíveis');
        expect(ctx.output()).toContain('MCP App concluído');
        expect(ctx.output()).toContain('Objetivo autopiloto + Contexto de extensão');
        expect(ctx.output()).toContain('Agentes customizados');
        expect(ctx.output()).toContain('ver Objetivo autopiloto + Contexto de extensão + Agentes customizados +6: /events 50');
        expect(ctx.output()).toContain('Objetivo autopiloto, Contexto de extensão, Agentes customizados +6');
        expect(ctx.output()).not.toContain(
            'Objetivo autopiloto, Contexto de extensão, Agentes customizados, Notificação customizada, Anexos de extensão',
        );
        expect(ctx.output()).toContain('/events sources detail');
        expect(ctx.output()).not.toContain('/events source terminal/dialog/turn-display.createDeltaCallback 50');
        expect(ctx.output()).not.toContain('user_input.requested');
        expect(ctx.output()).not.toContain('task.delta only when dialog loop is inactive');
        expect(ctx.output()).not.toContain('COPILOT_BYOK_* resolved into SDK provider');
    });

    it('preserva mapa técnico de fontes no modo detail', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, 'sources detail 50');

        expect(ctx.output()).toContain('Fontes do Terminal - Detalhe');
        expect(ctx.output()).toContain('/events --json compact · /events --raw preview · /events --raw full');
        expect(ctx.output()).toContain('payload público redigido; compacto usa preview e ids de filtro');
        expect(ctx.output()).toContain('assistant.text.delta');
        expect(ctx.output()).toContain('/events source terminal/dialog/turn-display.createDeltaCallback 50');
        expect(ctx.output()).toContain('task.delta only when dialog loop is inactive');
        expect(ctx.output()).toContain('COPILOT_BYOK_* resolved into SDK provider');
        expect(ctx.output()).toContain('/byok env · /byok profiles · /byok models refresh · /status');
        expect(ctx.output()).toContain('canvas.mcp-app.summary');
        expect(ctx.output()).toContain('mcp_app.tool_call_complete');
        expect(ctx.output()).toContain('raw iframe/canvas payload in default terminal output');
        expect(ctx.output()).toContain('sdk.session.extension-signals');
        expect(ctx.output()).toContain('session.autopilot_objective_changed');
        expect(ctx.output()).toContain('extension_context');
        expect(ctx.output()).toContain('unowned SDK 1.0 extension/session signals');
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
        expect(ctx.output()).toContain('2024-03-09T16:00:00.000+00:00 (há 5s)');
        expect(ctx.output()).toContain('rastreamento turn:abc');
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
        expect(ctx.output()).toContain('Sessão pronta');
        expect(ctx.output()).toContain('Aviso de quota');
        expect(ctx.output()).toContain('Modelo alterado');
        expect(ctx.output()).toContain('modelo auto → gpt-4.1-mini · raciocínio high');
        expect(ctx.output()).toContain('2024-03-09T16:00:00.000+00:00 (há 5s)');
        expect(ctx.output()).not.toContain('dialog loop changed');
        expect(ctx.output()).not.toContain('terminal runtime wired');
        expect(ctx.output()).not.toContain('quota warning');
        expect(ctx.output()).not.toContain('session model changed');
    });

    it('humaniza eventos SDK 1.0 novos no resumo default', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 4,
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
                    event: 'model.call_failure',
                    source: 'sdk/model.call_failure',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        data: {
                            source: 'top_level',
                            model: 'gpt-5.4',
                            statusCode: 429,
                            durationMs: 1200,
                            errorMessage: 'rate limited',
                            serviceRequestId: 'svc-request-123456',
                        },
                    },
                },
                {
                    timestamp: 1710000000500,
                    eventId: 5,
                    event: 'model.call_failure',
                    source: 'sdk/model.call_failure',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        data: {
                            source: 'top_level',
                            model: 'gpt-5.4-legacy',
                            statusCode: 400,
                            durationMs: 300,
                            errorMessage: 'model not supported by provider',
                            serviceRequestId: 'svc-request-legacy',
                        },
                    },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 2,
                    event: 'session.permissions_changed',
                    source: 'sdk/session.permissions_changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        data: {
                            previousAllowAllPermissions: false,
                            allowAllPermissions: true,
                        },
                    },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 3,
                    event: 'session.canvas.opened',
                    source: 'sdk/session.canvas.opened',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        data: {
                            title: 'Preview',
                            extensionName: 'Demo',
                            availability: 'ready',
                            reopen: true,
                        },
                    },
                },
                {
                    timestamp: 1710000003000,
                    eventId: 4,
                    event: 'hook.progress',
                    source: 'sdk/hook.progress',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { data: { message: 'rodando hook de segurança' } },
                },
                {
                    timestamp: 1710000004000,
                    eventId: 6,
                    event: 'mcp_app.tool_call_complete',
                    source: 'sdk/mcp_app.tool_call_complete',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        data: {
                            appName: 'Demo App',
                            toolName: 'show_panel',
                            status: 'completed',
                            title: 'Preview de painel',
                            uri: 'mcp://demo/panel',
                        },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '10');

        expect(ctx.output()).toContain('Falha do modelo');
        expect(ctx.output()).toContain('modelo gpt-5.4');
        expect(ctx.output()).toContain('classe rate limit');
        expect(ctx.output()).toContain('HTTP 429');
        expect(ctx.output()).toContain('modelo gpt-5.4-legacy');
        expect(ctx.output()).toContain('classe modelo incompatível');
        expect(ctx.output()).toContain('/model auto');
        expect(ctx.output()).toContain('Permissões da sessão');
        expect(ctx.output()).toContain('aprovação ampla ativada');
        expect(ctx.output()).toContain('Canvas aberto');
        expect(ctx.output()).toContain('Preview');
        expect(ctx.output()).toContain('Rotina em andamento');
        expect(ctx.output()).toContain('rodando hook de segurança');
        expect(ctx.output()).toContain('MCP App concluído');
        expect(ctx.output()).toContain('MCP App via SDK');
        expect(ctx.output()).toContain('app Demo App');
        expect(ctx.output()).toContain('tool show_panel');
        expect(ctx.output()).toContain('Preview de painel');
        expect(ctx.output()).toContain('recurso mcp://demo/panel');
        expect(ctx.output()).not.toContain('model call failure');
        expect(ctx.output()).not.toContain('session permissions changed');
        expect(ctx.output()).not.toContain('hook progress');
        expect(ctx.output()).not.toContain('appName');
    });

    it('resume anexos e conteúdos multimodais SDK 1.0 sem objetos crus', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 2,
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
                    event: 'tool.execution_complete',
                    source: 'sdk/tool.execution_complete',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        toolName: 'render_preview',
                        result: {
                            content: 'preview ready',
                            contents: [
                                { type: 'image', mimeType: 'image/png', data: 'BASE64_IMAGE_SHOULD_NOT_RENDER' },
                                { type: 'terminal', text: 'ok', exitCode: 0, cwd: '/repo' },
                                {
                                    type: 'resource_link',
                                    title: 'Relatório',
                                    name: 'report',
                                    uri: 'ui://report',
                                    mimeType: 'text/html',
                                },
                            ],
                        },
                    },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 2,
                    event: 'user.message',
                    source: 'sdk/user.message',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        content: 'analise isso',
                        attachments: [
                            { type: 'file', displayName: 'app.js', path: '/repo/app.js' },
                            { type: 'selection', displayName: 'trecho crítico', filePath: '/repo/app.js', text: 'secret-ish' },
                            {
                                type: 'github_reference',
                                referenceType: 'pr',
                                number: 42,
                                title: 'Upgrade SDK',
                                url: 'https://github.example/pull/42',
                                state: 'open',
                            },
                            { type: 'blob', displayName: 'payload.pdf', mimeType: 'application/pdf', data: 'BASE64_PDF_SHOULD_NOT_RENDER' },
                        ],
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '10');

        expect(ctx.output()).toContain('Ferramenta concluída');
        expect(ctx.output()).toContain('3 conteúdos');
        expect(ctx.output()).toContain('imagem image/png');
        expect(ctx.output()).toContain('terminal exit 0');
        expect(ctx.output()).toContain('link de recurso Relatório');
        expect(ctx.output()).toContain('Mensagem do operador');
        expect(ctx.output()).toContain('4 anexos');
        expect(ctx.output()).toContain('arquivo app.js');
        expect(ctx.output()).toContain('seleção trecho crítico');
        expect(ctx.output()).toContain('referência GitHub Upgrade SDK pr #42');
        expect(ctx.output()).not.toContain('BASE64_IMAGE_SHOULD_NOT_RENDER');
        expect(ctx.output()).not.toContain('BASE64_PDF_SHOULD_NOT_RENDER');
        expect(ctx.output()).not.toContain('[object Object]');
        expect(ctx.output()).not.toContain('tool execution complete');
        expect(ctx.output()).not.toContain('github reference');
    });

    it('humaniza sinais long-tail SDK 1.0 de extensões e sessão no resumo default', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 9,
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
                    eventId: 1,
                    event: 'session.autopilot_objective_changed',
                    source: 'sdk/session.autopilot_objective_changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { objective: 'Investigar falha de CI' },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 2,
                    event: 'extension_context',
                    source: 'sdk/extension_context',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { extensionName: 'GitHub', contextType: 'pull_request' },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 3,
                    event: 'session.custom_agents_updated',
                    source: 'sdk/session.custom_agents_updated',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { agents: [{ name: 'Reviewer' }] },
                },
                {
                    timestamp: 1710000003000,
                    eventId: 4,
                    event: 'session.custom_notification',
                    source: 'sdk/session.custom_notification',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { title: 'Aviso', message: 'Ação necessária', severity: 'warn' },
                },
                {
                    timestamp: 1710000004000,
                    eventId: 5,
                    event: 'session.extensions.attachments_pushed',
                    source: 'sdk/session.extensions.attachments_pushed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { extensionName: 'GitHub', attachments: [{ id: 'att-1' }] },
                },
                {
                    timestamp: 1710000005000,
                    eventId: 6,
                    event: 'session.remote_steerable_changed',
                    source: 'sdk/session.remote_steerable_changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { enabled: true },
                },
                {
                    timestamp: 1710000006000,
                    eventId: 7,
                    event: 'session.schedule_created',
                    source: 'sdk/session.schedule_created',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { scheduleId: 'sched-1', title: 'Revisão diária', cadence: 'daily' },
                },
                {
                    timestamp: 1710000007000,
                    eventId: 8,
                    event: 'session.schedule_cancelled',
                    source: 'sdk/session.schedule_cancelled',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { scheduleId: 'sched-1', title: 'Revisão diária' },
                },
                {
                    timestamp: 1710000008000,
                    eventId: 9,
                    event: 'new_inbox_message',
                    source: 'sdk/new_inbox_message',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { from: 'GitHub', subject: 'Nova solicitação' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('Objetivo autopiloto');
        expect(ctx.output()).toContain('objetivo Investigar falha de CI');
        expect(ctx.output()).toContain('Contexto de extensão');
        expect(ctx.output()).toContain('extensão GitHub');
        expect(ctx.output()).toContain('Agentes customizados');
        expect(ctx.output()).toContain('1 agente');
        expect(ctx.output()).toContain('Notificação customizada');
        expect(ctx.output()).toContain('Ação necessária');
        expect(ctx.output()).toContain('Anexos de extensão');
        expect(ctx.output()).toContain('1 anexo');
        expect(ctx.output()).toContain('Controle remoto');
        expect(ctx.output()).toContain('controle remoto ativado');
        expect(ctx.output()).toContain('Agendamento criado');
        expect(ctx.output()).toContain('Revisão diária');
        expect(ctx.output()).toContain('Agendamento cancelado');
        expect(ctx.output()).toContain('Mensagem recebida');
        expect(ctx.output()).toContain('de GitHub');
        expect(ctx.output()).not.toContain('autopilot objective changed');
        expect(ctx.output()).not.toContain('extension context');
        expect(ctx.output()).not.toContain('attachments_pushed');
    });

    it('usa operatorSummary para reconfirmação de modelo sem chamar de alteração', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 5,
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
                    timestamp: 1710000003000,
                    eventId: 4,
                    event: 'session.model_changed',
                    source: 'sdk/session.model_changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        previousModel: 'auto',
                        newModel: 'auto',
                        operatorSummary: 'confirmado sem troca: auto (sem troca) · origem SDK · 2026-06-04T23:29:37.513Z',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Modelo confirmado');
        expect(ctx.output()).toContain('confirmado sem troca: auto (sem troca) · origem SDK · 2026-06-04T23:29:37.513Z');
        expect(ctx.output()).not.toContain('Modelo alterado');
        expect(ctx.output()).not.toContain('modelo auto → auto');
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
                    source: 'agent/passthrough/question.answered',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: { questionId: 'q-1', answer: 'SIM' },
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
        expect(ctx.output()).toContain('Resposta encaminhada');
        expect(ctx.output()).toContain('ponte da pergunta');
        expect(ctx.output()).toContain('SIM');
        expect(ctx.output()).toContain('Tarefa em segundo plano concluída');
        expect(ctx.output()).toContain('Tarefa em segundo plano ociosa');
        expect(ctx.output()).toContain('tarefa em segundo plano');
        expect(ctx.output()).not.toContain('assistant reasoning complete');
        expect(ctx.output()).not.toContain('question answered');
        expect(ctx.output()).not.toContain('Resposta do operador');
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
        expect(ctx.output()).not.toContain('tipo I/O local');
        expect(ctx.output()).not.toContain('estado io op');
        expect(ctx.output()).not.toContain('io_op');
    });

    it('preserva tipos e classificações internas em consultas explícitas', async () => {
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
                source: 'agent/sdk.lifecycle',
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

        await cmdEvents({ println: ctx.println }, '20 source=agent/sdk.lifecycle');

        expect(ctx.output()).toContain('Sessão atualizada');
        expect(ctx.output()).toContain('controle da sessão');
        expect(ctx.output()).toContain('tipo continuação da pergunta humana');
        expect(ctx.output()).not.toContain('tipo sessão atualizada');
        expect(ctx.output()).not.toContain('Sessão SDK');
        expect(ctx.output()).not.toContain('tipo session.updated');
        expect(ctx.output()).not.toContain('ask user continuation');
        expect(ctx.output()).not.toContain('ask_user_continuation');
    });

    it('move eventos rotineiros para filtros explícitos e raw no resumo default', async () => {
        const routineEntries = [
            {
                timestamp: 1710000000000,
                eventId: 91,
                event: 'terminal.activity',
                source: 'terminal/activity',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { message: 'heartbeat de atividade' },
            },
            {
                timestamp: 1710000001000,
                eventId: 92,
                event: 'busy',
                source: 'terminal-dialog/busy',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { status: 'active' },
            },
            {
                timestamp: 1710000002000,
                eventId: 93,
                event: 'sdk.lifecycle',
                source: 'agent/sdk.lifecycle',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { type: 'session.updated' },
            },
            {
                timestamp: 1710000003000,
                eventId: 94,
                event: 'sdk.lifecycle',
                source: 'agent/sdk.lifecycle',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { type: 'session.deleted', label: 'Sessão SDK removida' },
            },
            {
                timestamp: 1710000004000,
                eventId: 95,
                event: 'hook.start',
                source: 'sdk/hooks',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { hookType: 'beforeToolUse' },
            },
            {
                timestamp: 1710000005000,
                eventId: 96,
                event: 'session.usage',
                source: 'terminal-dialog/usage',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { classification: 'non_user_initiated' },
            },
            {
                timestamp: 1710000006000,
                eventId: 97,
                event: 'streaming.progress',
                source: 'terminal-dialog/streaming',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { status: 'active' },
            },
            {
                timestamp: 1710000007000,
                eventId: 98,
                event: 'assistant.turn_end',
                source: 'sdk/assistant.turn_end',
                eventSource: null,
                traceId: null,
                turnId: 'turn-1',
                hubSessionId: null,
                payload: { turnId: 'turn-1' },
            },
            {
                timestamp: 1710000008000,
                eventId: 99,
                event: 'user_input.completed',
                source: 'sdk/user_input.completed',
                eventSource: null,
                traceId: null,
                turnId: null,
                hubSessionId: null,
                payload: { answer: 'SIM' },
            },
        ];
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: routineEntries.length,
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
            entries: routineEntries,
        });
        const defaultCtx = mockCtx();

        await cmdEvents({ println: defaultCtx.println }, '20');

        expect(defaultCtx.output()).toContain('Resposta do operador');
        expect(defaultCtx.output()).toContain('SIM');
        expect(defaultCtx.output()).not.toContain('Atividade');
        expect(defaultCtx.output()).not.toContain('Ocupado');
        expect(defaultCtx.output()).not.toContain('Sessão atualizada');
        expect(defaultCtx.output()).not.toContain('Sessão removida');
        expect(defaultCtx.output()).not.toContain('Rotina iniciada');
        expect(defaultCtx.output()).not.toContain('Uso LLM');
        expect(defaultCtx.output()).not.toContain('Streaming');
        expect(defaultCtx.output()).not.toContain('Turno concluído');

        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 20,
                event: 'sdk.lifecycle',
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: [routineEntries[2]],
        });
        const filteredCtx = mockCtx();

        await cmdEvents({ println: filteredCtx.println }, '20 event=sdk.lifecycle');

        expect(filteredCtx.output()).toContain('Sessão atualizada');
        expect(filteredCtx.output()).toContain('controle da sessão');

        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 20,
                event: 'assistant.turn_end',
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: [routineEntries[7]],
        });
        const turnCtx = mockCtx();

        await cmdEvents({ println: turnCtx.println }, '20 event=assistant.turn_end');

        expect(turnCtx.output()).toContain('Turno concluído');
    });

    it('humaniza erros BYOK, cancelamentos e turnos vazios no resumo default', async () => {
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
                    eventId: 61,
                    event: 'agent.error',
                    source: 'agent/error',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        hookType: 'errorOccurred',
                        errorContext: 'model_call',
                        recoverable: true,
                        message: 'Erro do SDK sem mensagem estruturada.',
                        byokEnabled: true,
                        byokProviderType: 'openai',
                        byokProfile: 'kilo',
                        byokModel: 'kilo-auto/free',
                        operatorMeaning:
                            'erro de provider BYOK; troque provider/modelo via /byok use ou /byok model',
                        handledAs: 'recoverable_model_call',
                    },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 62,
                    event: 'session.info',
                    source: 'sdk/session.info',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: { infoType: 'cancellation', message: 'Operation cancelled by user' },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 63,
                    event: 'terminal.turn.empty_recovery',
                    source: 'terminal-dialog/empty-recovery',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        actor: 'user',
                        attempt: 1,
                        maxAttempts: 1,
                        reason: 'pre_action_empty_output',
                        firstOutcome: 'empty',
                        firstReplySource: 'direct_dispatch',
                    },
                },
                {
                    timestamp: 1710000002500,
                    eventId: 66,
                    event: 'terminal.turn.empty_output',
                    source: 'terminal-dialog/empty-output',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        actor: 'agent',
                        sourceDetail: 'empty',
                        assistantMessageCount: 0,
                        deltaSlices: 0,
                        deltaChars: 0,
                        pendingQuestionKind: null,
                    },
                },
                {
                    timestamp: 1710000003000,
                    eventId: 64,
                    event: 'dialog.empty_after_user_input',
                    source: 'terminal-agent-wiring/dialog.empty_after_user_input',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        turnId: 'turn:ask',
                        detail: 'continuação após resposta humana sem texto público · resposta SIM',
                        requestId: 'ask-request-1234567890',
                    },
                },
                {
                    timestamp: 1710000003500,
                    eventId: 67,
                    event: 'dialog.empty_after_user_input.auto_recovery',
                    source: 'terminal-agent-wiring/dialog.empty_after_user_input.auto_recovery',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        turnId: 'turn:ask',
                        detail: 'continuação após resposta humana sem texto público · resposta SIM',
                        requestId: 'ask-request-1234567890',
                        recoveryKey: 'request:ask-request-1234567890',
                        resumeMessage:
                            'Continue a partir da ultima resposta humana e entregue a resposta final em texto publico.',
                    },
                },
                {
                    timestamp: 1710000004000,
                    eventId: 65,
                    event: 'llm.usage',
                    source: 'agent/llm.usage',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: { classification: 'non_user_initiated' },
                },
                {
                    timestamp: 1710000004100,
                    eventId: 68,
                    event: 'task.started',
                    source: 'agent',
                    eventSource: null,
                    traceId: 'turn:3',
                    turnId: '3',
                    hubSessionId: 'hub-1',
                    payload: { description: 'Continue a partir da ultima resposta humana.' },
                },
                {
                    timestamp: 1710000004200,
                    eventId: 69,
                    event: 'task.queued',
                    source: 'agent',
                    eventSource: null,
                    traceId: 'turn:3',
                    turnId: '3',
                    hubSessionId: 'hub-1',
                    payload: { description: 'Continue a partir da ultima resposta humana.' },
                },
                {
                    timestamp: 1710000004300,
                    eventId: 70,
                    event: 'pending_messages.modified',
                    source: 'sdk/pending_messages.modified',
                    eventSource: null,
                    traceId: 'turn:3',
                    turnId: '3',
                    hubSessionId: 'hub-1',
                    payload: { count: 2 },
                },
                {
                    timestamp: 1710000004400,
                    eventId: 71,
                    event: 'session.tools_updated',
                    source: 'sdk/session.tools_updated',
                    eventSource: null,
                    traceId: 'turn:3',
                    turnId: '3',
                    hubSessionId: 'hub-1',
                    payload: { count: 105 },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('Erro BYOK');
        expect(ctx.output()).toContain('erro do agente');
        expect(ctx.output()).toContain('falha da rota BYOK');
        expect(ctx.output()).toContain('provedor openai');
        expect(ctx.output()).toContain('tratado como erro recuperável do modelo');
        expect(ctx.output()).not.toContain('classe erro recuperável do modelo');
        expect(ctx.output()).not.toContain('falha do provider BYOK');
        expect(ctx.output()).not.toContain('falha do provedor BYOK');
        expect(ctx.output()).not.toContain('provider openai');
        expect(ctx.output()).toContain('contexto chamada do modelo');
        expect(ctx.output()).toContain('Cancelamento');
        expect(ctx.output()).toContain('controle da sessão');
        expect(ctx.output()).toContain('operação cancelada pelo operador');
        expect(ctx.output()).toContain('Recuperação de turno');
        expect(ctx.output()).toContain('tentativa 1/1');
        expect(ctx.output()).toContain('motivo turno vazio antes de ação');
        expect(ctx.output()).toContain('sem tool, delta ou pergunta pendente');
        expect(ctx.output()).toContain('Turno sem saída');
        expect(ctx.output()).toContain('autor agente');
        expect(ctx.output()).toContain('origem sem saída');
        expect(ctx.output()).toContain('deltas 0/0 caracteres');
        expect(ctx.output()).toContain('Continuação vazia');
        expect(ctx.output()).toContain('continuação após resposta humana sem texto público · resposta SIM');
        expect(ctx.output()).toContain(
            'retomar /turn Continue a partir da ultima resposta humana e entregue a resposta final em texto publico.',
        );
        expect(ctx.output()).toContain('diagnóstico /activity 40 · /events 60 · /byok health');
        expect(ctx.output()).toContain('Retomada automática');
        expect(ctx.output()).toContain('retomada automática enviada uma vez');
        expect(ctx.output()).toContain('sem repetir a pergunta humana');
        expect(ctx.output()).toContain('Tarefa iniciada');
        expect(ctx.output()).toContain('Tarefa enfileirada');
        expect(ctx.output()).toContain('Fila de mensagens alterada');
        expect(ctx.output()).toContain('Ferramentas da sessão atualizadas');
        expect(ctx.output()).not.toContain('task started');
        expect(ctx.output()).not.toContain('task queued');
        expect(ctx.output()).not.toContain('pending messages modified');
        expect(ctx.output()).not.toContain('session tools updated');
        expect(ctx.output()).not.toContain('ask-request-1234567890');
        expect(ctx.output()).not.toContain('request:ask-request');
        expect(ctx.output()).toContain('tipo iniciado pelo agente');
        expect(ctx.output()).not.toContain('agent error');
        expect(ctx.output()).not.toContain('Info da sessão');
        expect(ctx.output()).not.toContain('terminal turn empty output');
        expect(ctx.output()).not.toContain('Operation cancelled by user');
        expect(ctx.output()).not.toContain('non user initiated');
        expect(ctx.output()).not.toContain('non_user_initiated');
        expect(ctx.output()).not.toContain('model_call');
        expect(ctx.output()).not.toContain('recoverable_model_call');
        expect(ctx.output()).not.toContain('errorOccurred');
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

    it('oculta eventos internos no resumo default sem esconder consultas explicitas', async () => {
        const internalAck = {
            timestamp: 1710000000000,
            eventId: 81,
            event: 'agent.background.completed',
            source: 'agent/background.completed',
            eventSource: null,
            traceId: 'turn:1',
            turnId: '1',
            hubSessionId: 'hub-1',
            payload: {
                description: 'Clear persisted pendingQuestion',
                status: 'success',
                internal: true,
                visible: false,
            },
        };
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
                internalAck,
                {
                    timestamp: 1710000001000,
                    eventId: 82,
                    event: 'user_input.completed',
                    source: 'sdk/user_input.completed',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: { answer: 'SIM' },
                },
            ],
        });
        const defaultCtx = mockCtx();

        await cmdEvents({ println: defaultCtx.println }, '20');

        expect(defaultCtx.output()).toContain('Resposta do operador');
        expect(defaultCtx.output()).toContain('SIM');
        expect(defaultCtx.output()).not.toContain('Tarefa em segundo plano concluída');
        expect(defaultCtx.output()).not.toContain('Clear persisted pendingQuestion');

        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 20,
                event: 'agent.background.completed',
                traceId: null,
                turnId: null,
                source: null,
                toolCallId: null,
                requestId: null,
                hubSessionId: null,
            },
            entries: [internalAck],
        });
        const filteredCtx = mockCtx();

        await cmdEvents({ println: filteredCtx.println }, '20 event=agent.background.completed');

        expect(filteredCtx.output()).toContain('Tarefa em segundo plano concluída');
        expect(filteredCtx.output()).toContain('Clear persisted pendingQuestion');
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

    it('busca janela bruta maior no default e limita eventos operacionais visíveis', async () => {
        const hiddenRoutineEvents = Array.from({ length: 20 }, (_, index) => ({
            timestamp: 1710000000100 + index,
            eventId: 300 + index,
            event: 'sdk.lifecycle',
            source: 'agent/sdk.lifecycle',
            eventSource: null,
            traceId: 'turn:1',
            turnId: '1',
            hubSessionId: null,
            payload: { type: 'session.updated', label: 'Sessão SDK atualizada' },
        }));
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 23,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 100,
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
                    payload: { content: 'DELTA-CANONICAL-8' },
                },
                ...hiddenRoutineEvents,
                {
                    timestamp: 1710000002000,
                    eventId: 204,
                    event: 'user_input.requested',
                    source: 'sdk/user_input.requested',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: null,
                    payload: { requestId: 'ask-1', question: 'ASK-CANONICAL: responda SIM' },
                },
                {
                    timestamp: 1710000003000,
                    eventId: 213,
                    event: 'user_input.completed',
                    source: 'sdk/user_input.completed',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: null,
                    payload: { requestId: 'ask-1', content: 'SIM' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '2');

        expect(readTerminalSseEventArchiveTail).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100 }));
        expect(ctx.output()).toContain('Eventos SSE - últimas 2');
        expect(ctx.output()).toContain('Pergunta ao operador');
        expect(ctx.output()).toContain('Resposta do operador');
        expect(ctx.output()).not.toContain('Mensagem da LLM-B');
        expect(ctx.output()).not.toContain('Sessão atualizada');
    });

    it('humaniza labels e detalhes de sessão/intenção no default', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 3,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 100,
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
                    eventId: 20,
                    event: 'session.info',
                    source: 'sdk/session.info',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { infoType: 'configuration', message: 'Disabled tools: bash, glob' },
                },
                {
                    timestamp: 1710000001000,
                    eventId: 21,
                    event: 'session.title_changed',
                    source: 'sdk/session.title_changed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { title: 'Terminal live' },
                },
                {
                    timestamp: 1710000002000,
                    eventId: 22,
                    event: 'assistant.intent',
                    source: 'terminal-intent/assistant.intent',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { intent: 'testar fluxo' },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20');

        expect(ctx.output()).toContain('Configuração');
        expect(ctx.output()).toContain('tipo configuração');
        expect(ctx.output()).toContain('Ferramentas desabilitadas: bash, glob');
        expect(ctx.output()).toContain('Título da sessão');
        expect(ctx.output()).toContain('Intenção da LLM-B');
        expect(ctx.output()).not.toContain('Disabled tools');
        expect(ctx.output()).not.toContain('tipo configuration');
        expect(ctx.output()).not.toContain('session title changed');
        expect(ctx.output()).not.toContain('assistant intent');
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

    it('emite JSON compacto parseável com preview em vez de payload completo', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '3 --json compact event=delta');

        const parsed = JSON.parse(ctx.output());
        expect(parsed.filters).toMatchObject({ limit: 5, event: 'delta' });
        expect(parsed.entries[0]).toMatchObject({
            eventId: 42,
            event: 'delta',
            traceId: 'turn:abc',
            turnId: 'turn-1',
            hubSessionId: 'hub-1',
            toolCallId: 'call_123',
            requestId: 'req-123',
            payloadKeys: expect.arrayContaining(['content']),
            payloadPreview: expect.stringContaining('DELTA-CANONICAL-1'),
        });
        expect(parsed.entries[0]).not.toHaveProperty('payload');
    });

    it('usa publicChunk seguro no preview de JSON compacto de delta', async () => {
        readTerminalSseEventArchiveTail.mockResolvedValueOnce({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 5,
                event: 'delta',
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
                    eventId: 43,
                    event: 'delta',
                    source: 'terminal-dialog/delta',
                    eventSource: null,
                    traceId: 'turn:abc',
                    turnId: 'turn-1',
                    hubSessionId: 'hub-1',
                    payload: {
                        chunk: '<thinking>segredo</thinking>\nDELTA-CANONICAL-1',
                        publicChunk: 'DELTA-CANONICAL-1',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '3 --json compact event=delta');

        const parsed = JSON.parse(ctx.output());
        expect(parsed.entries[0]).toMatchObject({
            eventId: 43,
            event: 'delta',
            payloadKeys: expect.arrayContaining(['chunk', 'publicChunk']),
            payloadPreview: 'DELTA-CANONICAL-1',
        });
        expect(JSON.stringify(parsed.entries[0])).not.toContain('segredo');
        expect(parsed.entries[0]).not.toHaveProperty('payload');
    });

    it('emite preview JSONL raw compacto para comparacao visual com artefatos SSE', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '3 --raw event=delta');

        expect(ctx.output()).toContain('Eventos SSE raw - preview');
        expect(ctx.output()).toContain('/events 5 --raw full');
        const rawLine = ctx
            .output()
            .trim()
            .split('\n')
            .find((line) => line.trim().startsWith('{'));
        expect(JSON.parse(rawLine)).toMatchObject({
            eventId: 42,
            event: 'delta',
            traceId: 'turn:abc',
            turnId: 'turn-1',
            hubSessionId: 'hub-1',
            toolCallId: 'call_123',
            requestId: 'req-123',
            payloadKeys: expect.arrayContaining(['content']),
            payloadPreview: expect.stringContaining('DELTA-CANONICAL-1'),
        });
        expect(ctx.output()).not.toContain('"payload":');
    });

    it('mantém JSONL raw completo quando solicitado explicitamente', async () => {
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '3 --raw full event=delta');

        const lines = ctx.output().trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({
            eventId: 42,
            event: 'delta',
            payload: { content: 'DELTA-CANONICAL-1' },
        });
    });

    it('redige segredos em /events --json, --raw full e preview raw sem perder o formato técnico', async () => {
        const secretProjection = () => ({
            state: {
                path: 'data/copilot-terminal/sse-events/terminal-sse-events-2026-05-20.jsonl',
                events: 1,
                queueDepth: 0,
                error: null,
            },
            filters: {
                limit: 5,
                event: 'tool.execution_complete',
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
                    eventId: 77,
                    event: 'tool.execution_complete',
                    source: 'sdk/tool.execution_complete',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: {
                        headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' },
                        content: 'api_key=sk-testsecret123456789',
                    },
                },
            ],
        });

        readTerminalSseEventArchiveTail.mockResolvedValueOnce(secretProjection());
        const jsonCtx = mockCtx();
        await cmdEvents({ println: jsonCtx.println }, '5 --json event=tool.execution_complete');
        const json = JSON.parse(jsonCtx.output());
        expect(json.entries[0].payload.headers.Authorization).toBe('[redacted]');
        expect(json.entries[0].payload.content).toBe('api_key=[redacted]');
        expect(jsonCtx.output()).not.toContain('abcdefghijklmnopqrstuvwxyz');
        expect(jsonCtx.output()).not.toContain('sk-testsecret123456789');

        readTerminalSseEventArchiveTail.mockResolvedValueOnce(secretProjection());
        const fullCtx = mockCtx();
        await cmdEvents({ println: fullCtx.println }, '5 --raw full event=tool.execution_complete');
        const full = JSON.parse(fullCtx.output());
        expect(full.payload.headers.Authorization).toBe('[redacted]');
        expect(full.payload.content).toBe('api_key=[redacted]');
        expect(fullCtx.output()).not.toContain('abcdefghijklmnopqrstuvwxyz');
        expect(fullCtx.output()).not.toContain('sk-testsecret123456789');

        readTerminalSseEventArchiveTail.mockResolvedValueOnce(secretProjection());
        const previewCtx = mockCtx();
        await cmdEvents({ println: previewCtx.println }, '5 --raw event=tool.execution_complete');
        expect(previewCtx.output()).toContain('Eventos SSE raw - preview');
        expect(previewCtx.output()).not.toContain('abcdefghijklmnopqrstuvwxyz');
        expect(previewCtx.output()).not.toContain('sk-testsecret123456789');
    });

    it('humaniza payloadPreview de activity e hooks no preview raw', async () => {
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
                    schemaVersion: 1,
                    timestamp: 1710000001000,
                    eventId: 50,
                    event: 'activity.changed',
                    source: 'terminal',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        current: {
                            phase: 'tool',
                            label: 'Integração externa concluída',
                            detail: 'lendo arquivo concluído · arquivo: package.json',
                            toolName: 'read_file_content',
                            progress: 100,
                        },
                        previous: {
                            label: 'Ferramenta em uso',
                        },
                    },
                },
                {
                    schemaVersion: 1,
                    timestamp: 1710000002000,
                    eventId: 51,
                    event: 'hook.start',
                    source: 'sdk/hook.start',
                    eventSource: null,
                    traceId: 'turn:1',
                    turnId: '1',
                    hubSessionId: 'hub-1',
                    payload: {
                        hookType: 'postToolUse',
                        input: { toolName: 'read_file_content' },
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20 --raw');

        const previewLines = ctx
            .output()
            .trim()
            .split('\n')
            .filter((line) => line.trim().startsWith('{'))
            .map((line) => JSON.parse(line));
        expect(previewLines[0].payloadPreview).toContain('fase ferramenta');
        expect(previewLines[0].payloadPreview).toContain('Integração externa concluída');
        expect(previewLines[0].payloadPreview).not.toContain('{"current"');
        expect(previewLines[1].payloadPreview).toContain('rotina posttooluse');
        expect(previewLines[1].payloadPreview).toContain('iniciado');
        expect(previewLines[1].payloadPreview).not.toContain('{"hookType"');
    });

    it('humaniza conclusão interna de turno no payloadPreview raw sem sugerir fim final', async () => {
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
                    schemaVersion: 1,
                    timestamp: 1710000001000,
                    eventId: 86,
                    event: 'activity.changed',
                    source: 'terminal',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        current: {
                            phase: 'turn',
                            label: 'Turno do assistente concluído',
                            detail: 'turno 0',
                        },
                        previous: {
                            phase: 'tool',
                            label: 'Leitura concluída',
                            detail: 'package.json',
                        },
                    },
                },
                {
                    schemaVersion: 1,
                    timestamp: 1710000002000,
                    eventId: 87,
                    event: 'terminal.activity',
                    source: 'sdk',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        phase: 'turn',
                        label: 'Turno do assistente concluído',
                        detail: 'turno 0',
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20 --raw');

        const previews = ctx
            .output()
            .trim()
            .split('\n')
            .filter((line) => line.trim().startsWith('{'))
            .map((line) => JSON.parse(line).payloadPreview);
        expect(previews[0]).toContain('continuação do pedido');
        expect(previews[0]).not.toContain('Turno do assistente concluído');
        expect(previews[1]).toContain('etapa da LLM-B encerrada');
        expect(previews[1]).not.toContain('Turno do assistente concluído');
    });

    it('humaniza payloadPreview de boot, quota e background no preview raw', async () => {
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
                    schemaVersion: 1,
                    timestamp: 1710000001000,
                    eventId: 60,
                    event: 'terminal.runtime.wired',
                    source: 'terminal/runtime-root.runtime-config',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: null,
                    payload: { phase: 'runtime-config', durationMs: 7, preflightOk: true },
                },
                {
                    schemaVersion: 1,
                    timestamp: 1710000002000,
                    eventId: 61,
                    event: 'terminal.started',
                    source: 'terminal-boot/terminal.started',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        operationMode: 'standalone',
                        model: 'auto',
                        mcpToolCount: 0,
                        dialogLoopActive: false,
                        bootPreflight: { ok: true },
                    },
                },
                {
                    schemaVersion: 1,
                    timestamp: 1710000003000,
                    eventId: 62,
                    event: 'quota.warning',
                    source: 'agent/passthrough/quota.warning',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        quotaId: 'premium_interactions',
                        snapshot: { hasQuota: false, remainingPercentage: 0, resetDate: '2026-06-08T11:10:36.070Z' },
                    },
                },
                {
                    schemaVersion: 1,
                    timestamp: 1710000004000,
                    eventId: 63,
                    event: 'agent.background.completed',
                    source: 'agent/background.completed',
                    eventSource: null,
                    traceId: null,
                    turnId: null,
                    hubSessionId: 'hub-1',
                    payload: {
                        status: 'success',
                        label: 'session.cleanup.stale',
                        durationMs: 42,
                        pendingCount: 0,
                    },
                },
            ],
        });
        const ctx = mockCtx();

        await cmdEvents({ println: ctx.println }, '20 --raw');

        const previews = ctx
            .output()
            .trim()
            .split('\n')
            .filter((line) => line.trim().startsWith('{'))
            .map((line) => JSON.parse(line).payloadPreview);
        expect(previews[0]).toContain('fase configuração do ambiente');
        expect(previews[0]).toContain('checagem ok');
        expect(previews[0]).not.toContain('runtime config');
        expect(previews[0]).not.toContain('preflight');
        expect(previews[0]).not.toContain('{"phase"');
        expect(previews[1]).toContain('standalone');
        expect(previews[1]).toContain('modelo auto');
        expect(previews[1]).not.toContain('{"timestamp"');
        expect(previews[2]).toContain('premium interactions');
        expect(previews[2]).toContain('sem quota');
        expect(previews[2]).not.toContain('{"quotaId"');
        expect(previews[3]).toContain('estado concluído');
        expect(previews[3]).toContain('session.cleanup.stale');
        expect(previews[3]).not.toContain('{"agentType"');
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
