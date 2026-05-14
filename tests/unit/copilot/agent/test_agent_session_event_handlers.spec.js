// @ts-check
/**
 * @file Faixa 43 — Agent: session event-wirer + event-handlers + history-sync + webhook-manager
 *
 *   Cobre módulos verdadeiramente sem cobertura no agent/:
 *
 *   - event-wirer.js (73L) — wireSessionEvents orchestration
 *   - src/copilot/event-handlers/catch-all.js (99L) — KNOWN_SDK_EVENTS + wireCatchAll
 *   - src/copilot/event-handlers/sdk-responses.js (126L) — wireSdkResponseEvents
 *   - src/copilot/event-handlers/token-budget.js (54L) — wireTokenBudgetEvents
 *   - src/copilot/event-handlers/system-notifications.js (67L) — wireSystemNotificationEvents
 *   - session/history/history-sync.js (108L) — syncSdkHistory + SessionMessagesCache
 *   - infra/webhook-manager.js (233L) — WebhookManager
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    logSwallowed: vi.fn(),
    validateWebhookUrl: vi.fn(),
    checkResolvedIp: vi.fn(),
    conversationStore: { syncFromSdkHistory: vi.fn(() => ({ synced: 3, skipped: 1 })) },
    getHubSessionId: vi.fn(() => 'hub-1'),
    defaultMetrics: {
        getSummary: vi.fn(() => ({ dialog: { turnsTotal: 5 }, tokens: { inputTokens: 100, outputTokens: 200 } })),
    },
    readTodoStore: vi.fn(async () => ({ tasks: {} })),
    safeJsonParse: vi.fn((/** @type {string} */ raw) => {
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: false, data: null };
        }
    }),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mocks.log,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));
vi.mock('#copilot/core/error-handlers', () => ({ logSwallowed: mocks.logSwallowed }));
// Mock env com Proxy que retorna defaults para qualquer export não explicitamente definido
vi.mock(
    '#copilot/config/env',
    () =>
        new Proxy(
            {
                WEBHOOK_ALLOW_PRIVATE_HOSTS: false,
                BRIDGE_ADMIN_TOKEN: 'test',
                SSE_REPLAY_BUFFER_SIZE: 100,
                SSE_MAX_CONCURRENT: 10,
                LLM_B_DIALOG_QUEUE_MAX: 50,
                TERMINAL_MAX_INJECT_HISTORY: 20,
                TERMINAL_MAX_LISTENERS: 50,
                TERMINAL_MAX_ATTACHMENTS: 10,
                TERMINAL_SHOW_STREAMING: true,
                TERMINAL_SHOW_THINKING: true,
                TERMINAL_SHOW_USAGE: true,
                CONTEXT_UTIL_WARN_THRESHOLD: 0.9,
                COPILOT_MODEL: 'gpt-4o',
                COPILOT_REASONING_EFFORT: '',
                COPILOT_HUB_SOCKET_AUTH_REQUIRED: false,
                DASHBOARD_SOCKET_AUTH_REQUIRED: false,
                COPILOT_MCP_SERVERS: '',
                COPILOT_CUSTOM_AGENTS: '',
                COPILOT_DISABLED_AGENTS: '',
                AGENT_MAX_LISTENERS: 100,
            },
            {
                get: (target, prop) =>
                    typeof prop === 'string' && prop in target
                        ? target[/** @type {keyof typeof target} */ (prop)]
                        : typeof prop === 'string'
                          ? ''
                          : undefined,
                has: () => true,
            },
        ),
);
// Mock conversationStore (deep deps from history-sync)
vi.mock('#copilot/conversation-hub/store', () => ({
    conversationStore: mocks.conversationStore,
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cria mock de CopilotSession com suporte a `.on(event, handler)` + `.on(handler)`. Retorna unsubscribe functions e
 * permite emitir eventos.
 */
function createMockSession() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();
    /** @type {Function[]} */
    const catchAll = [];

    const session = {
        sessionId: 'sess-1',
        /** @param {string | Function} eventOrHandler @param {Function} [handler] */
        on(eventOrHandler, handler) {
            if (typeof eventOrHandler === 'function') {
                catchAll.push(eventOrHandler);
                return () => {
                    const idx = catchAll.indexOf(eventOrHandler);
                    if (idx >= 0) catchAll.splice(idx, 1);
                };
            }
            const arr = listeners.get(eventOrHandler) || [];
            const fn = /** @type {Function} */ (handler);
            arr.push(fn);
            listeners.set(eventOrHandler, arr);
            return () => {
                const i = arr.indexOf(fn);
                if (i >= 0) arr.splice(i, 1);
            };
        },
        /** @param {string} event @param {object} [data] */
        _emit(event, data) {
            const evtObj = { kind: event, type: event, data };
            for (const fn of listeners.get(event) || []) fn(evtObj);
            for (const fn of catchAll) fn(evtObj);
        },
        getMessages: vi.fn(async () => [
            { id: 'm1', type: 'user', content: 'hello', createdAt: 1 },
            { id: 'm2', type: 'assistant', content: 'hi', createdAt: 2 },
        ]),
    };
    return session;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Event Handlers: catch-all.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('F43 — event-handlers/catch-all', () => {
    it('KNOWN_SDK_EVENTS é um Set com >50 eventos conhecidos', async () => {
        const { KNOWN_SDK_EVENTS } = await import('#copilot/event-handlers/catch-all');
        expect(KNOWN_SDK_EVENTS).toBeInstanceOf(Set);
        expect(KNOWN_SDK_EVENTS.size).toBeGreaterThan(50);
    });

    it('KNOWN_SDK_EVENTS contém eventos fundamentais', async () => {
        const { KNOWN_SDK_EVENTS } = await import('#copilot/event-handlers/catch-all');
        for (const evt of ['assistant.message', 'session.idle', 'session.error', 'tool.execution_start', 'abort']) {
            expect(KNOWN_SDK_EVENTS.has(evt)).toBe(true);
        }
    });

    it('wireCatchAll retorna unsubscribe function', async () => {
        const { wireCatchAll } = await import('#copilot/event-handlers/catch-all');
        const session = createMockSession();
        const unsub = wireCatchAll(/** @type {any} */ (session));
        expect(typeof unsub).toBe('function');
    });

    it('wireCatchAll ignora eventos conhecidos sem logar WARN', async () => {
        const { wireCatchAll } = await import('#copilot/event-handlers/catch-all');
        const session = createMockSession();
        wireCatchAll(/** @type {any} */ (session));
        mocks.log.mockClear();
        session._emit('session.idle', {});
        expect(mocks.log).not.toHaveBeenCalledWith('WARN', expect.anything());
    });

    it('wireCatchAll loga WARN para eventos desconhecidos', async () => {
        const { wireCatchAll } = await import('#copilot/event-handlers/catch-all');
        const session = createMockSession();
        wireCatchAll(/** @type {any} */ (session));
        mocks.log.mockClear();
        session._emit('future.unknown.event', {});
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('Evento SDK desconhecido'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Event Handlers: sdk-responses.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('F43 — event-handlers/sdk-responses', () => {
    it('wireSdkResponseEvents retorna array de unsubscribe functions', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBeGreaterThan(0);
        unsubs.forEach((u) => expect(typeof u).toBe('function'));
    });

    it('emite assistant.intent ao receber evento', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('assistant.intent', { intent: 'code_edit' });
        expect(emit).toHaveBeenCalledWith('assistant.intent', expect.objectContaining({ intent: 'code_edit' }));
    });

    it('emite assistant.message com content quando o SDK envia mensagem final', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('assistant.message', { messageId: 'm-1', content: 'fallback reply' });
        expect(emit).toHaveBeenCalledWith(
            'assistant.message',
            expect.objectContaining({ messageId: 'm-1', content: 'fallback reply' }),
        );
    });

    it('emite session.error com errorType e message', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('session.error', { errorType: 'rate_limit', message: 'Too many requests' });
        expect(emit).toHaveBeenCalledWith(
            'session.error',
            expect.objectContaining({
                errorType: 'rate_limit',
                message: 'Too many requests',
            }),
        );
    });

    it('emite session.handoff com fromAgent/toAgent', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('session.handoff', { fromAgent: 'a1', toAgent: 'a2', reason: 'capacity' });
        expect(emit).toHaveBeenCalledWith(
            'session.handoff',
            expect.objectContaining({
                fromAgent: 'a1',
                toAgent: 'a2',
            }),
        );
    });

    it('emite session.truncation com contadores', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('session.truncation', { messageTruncatedCount: 5, tokensTruncated: 1000, reason: 'overflow' });
        expect(emit).toHaveBeenCalledWith(
            'session.truncation',
            expect.objectContaining({
                messageTruncatedCount: 5,
                tokensTruncated: 1000,
            }),
        );
    });

    it('emite session.shutdown com payload bruto do SDK', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('session.shutdown', { shutdownType: 'graceful', reason: 'user_exit' });
        expect(emit).toHaveBeenCalledWith(
            'session.shutdown',
            expect.objectContaining({
                shutdownType: 'graceful',
                reason: 'user_exit',
            }),
        );
    });

    it('emite session.workspace_file_changed com path e operation', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });
        session._emit('session.workspace_file_changed', { path: 'files/plan.md', operation: 'update' });
        expect(emit).toHaveBeenCalledWith(
            'session.workspace_file_changed',
            expect.objectContaining({
                path: 'files/plan.md',
                operation: 'update',
            }),
        );
    });

    it('normaliza elicitation.requested e elicitation.completed conforme rpc.d.ts do SDK', async () => {
        const { wireSdkResponseEvents } = await import('#copilot/event-handlers/sdk-responses');
        const session = createMockSession();
        const emit = vi.fn();
        wireSdkResponseEvents(/** @type {any} */ (session), { emit });

        session._emit('elicitation.requested', {
            requestId: 'el-1',
            toolCallId: 'tool-1',
            elicitationSource: 'mcp-server',
            message: 'Escolha o ambiente',
            mode: 'form',
            requestedSchema: {
                type: 'object',
                properties: { env: { type: 'string', enum: ['dev', 'prod'] } },
                required: ['env'],
            },
        });

        expect(emit).toHaveBeenCalledWith(
            'elicitation.pending',
            expect.objectContaining({
                requestId: 'el-1',
                message: 'Escolha o ambiente',
                mode: 'form',
                requestedSchema: expect.objectContaining({ type: 'object' }),
                toolCallId: 'tool-1',
                elicitationSource: 'mcp-server',
            }),
        );

        session._emit('elicitation.completed', { requestId: 'el-1' });
        expect(emit).toHaveBeenCalledWith('elicitation.completed', expect.objectContaining({ requestId: 'el-1' }));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Event Handlers: token-budget.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('F43 — event-handlers/token-budget', () => {
    it('wireTokenBudgetEvents retorna array com 1 unsubscribe', async () => {
        const { wireTokenBudgetEvents } = await import('#copilot/event-handlers/token-budget');
        const session = createMockSession();
        const emit = vi.fn();
        const onContextState = vi.fn();
        const unsubs = wireTokenBudgetEvents(/** @type {any} */ (session), false, { emit, onContextState });
        expect(unsubs).toHaveLength(1);
    });

    it('emite session.usage e atualiza contextState', async () => {
        const { wireTokenBudgetEvents } = await import('#copilot/event-handlers/token-budget');
        const session = createMockSession();
        const emit = vi.fn();
        const onContextState = vi.fn();
        wireTokenBudgetEvents(/** @type {any} */ (session), false, { emit, onContextState });
        session._emit('session.usage_info', { currentTokens: 5000, tokenLimit: 10000 });
        expect(emit).toHaveBeenCalledWith('session.usage', expect.objectContaining({ currentTokens: 5000 }));
        expect(onContextState).toHaveBeenCalledWith(
            expect.objectContaining({
                tokens: 5000,
                tokenLimit: 10000,
                utilization: 0.5,
            }),
        );
    });

    it('emite token_budget_warning quando utilização >90%', async () => {
        const { wireTokenBudgetEvents } = await import('#copilot/event-handlers/token-budget');
        const session = createMockSession();
        const emit = vi.fn();
        const onContextState = vi.fn();
        wireTokenBudgetEvents(/** @type {any} */ (session), false, { emit, onContextState });
        session._emit('session.usage_info', { currentTokens: 9500, tokenLimit: 10000 });
        const warningCall = emit.mock.calls.find((/** @type {any[]} */ c) => c[0] === 'session.token_budget_warning');
        expect(warningCall).toBeDefined();
    });

    it('emite token_budget_warning de startup heavy em sessão retomada (>70%)', async () => {
        const { wireTokenBudgetEvents } = await import('#copilot/event-handlers/token-budget');
        const session = createMockSession();
        const emit = vi.fn();
        const onContextState = vi.fn();
        wireTokenBudgetEvents(/** @type {any} */ (session), true, { emit, onContextState });
        session._emit('session.usage_info', { currentTokens: 8000, tokenLimit: 10000 });
        const warningCall = emit.mock.calls.find((/** @type {any[]} */ c) => c[0] === 'session.token_budget_warning');
        expect(warningCall).toBeDefined();
        expect(warningCall?.[1]?.reason).toBe('startup_heavy');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Event Handlers: system-notifications.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('F43 — event-handlers/system-notifications', () => {
    it('wireSystemNotificationEvents retorna array com 1 unsubscribe', async () => {
        const { wireSystemNotificationEvents } = await import('#copilot/event-handlers/system-notifications');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireSystemNotificationEvents(/** @type {any} */ (session), { emit });
        expect(unsubs).toHaveLength(1);
    });

    it('emite agent.background.completed para system.notification type=agent_completed', async () => {
        const { wireSystemNotificationEvents } = await import('#copilot/event-handlers/system-notifications');
        const session = createMockSession();
        const emit = vi.fn();
        wireSystemNotificationEvents(/** @type {any} */ (session), { emit });
        session._emit('system.notification', { kind: { type: 'agent_completed', agentId: 'a1', status: 'success' } });
        expect(emit).toHaveBeenCalledWith(
            'agent.background.completed',
            expect.objectContaining({
                agentId: 'a1',
                status: 'success',
            }),
        );
    });

    it('emite agent.shell.completed para type=shell_completed', async () => {
        const { wireSystemNotificationEvents } = await import('#copilot/event-handlers/system-notifications');
        const session = createMockSession();
        const emit = vi.fn();
        wireSystemNotificationEvents(/** @type {any} */ (session), { emit });
        session._emit('system.notification', { kind: { type: 'shell_completed', shellId: 's1', exitCode: 0 } });
        expect(emit).toHaveBeenCalledWith(
            'agent.shell.completed',
            expect.objectContaining({
                shellId: 's1',
                exitCode: 0,
            }),
        );
    });

    it('ignora notificações sem kind.type', async () => {
        const { wireSystemNotificationEvents } = await import('#copilot/event-handlers/system-notifications');
        const session = createMockSession();
        const emit = vi.fn();
        wireSystemNotificationEvents(/** @type {any} */ (session), { emit });
        session._emit('system.notification', {});
        expect(emit).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. session/history/history-sync.js — SessionMessagesCache
// ═══════════════════════════════════════════════════════════════════════════════

describe('F43 — SessionMessagesCache', () => {
    it('retorna array vazio quando session é null', async () => {
        const { SessionMessagesCache } = await import('#copilot/agent/session');
        const cache = new SessionMessagesCache(5000);
        const result = await cache.get(null);
        expect(result).toEqual([]);
    });

    it('retorna mensagens da sessão na primeira chamada', async () => {
        const { SessionMessagesCache } = await import('#copilot/agent/session');
        const cache = new SessionMessagesCache(60000);
        const session = createMockSession();
        const result = await cache.get(/** @type {any} */ (session));
        expect(result).toHaveLength(2);
        expect(session.getMessages).toHaveBeenCalled();
    });

    it('retorna do cache na segunda chamada dentro do TTL', async () => {
        const { SessionMessagesCache } = await import('#copilot/agent/session');
        const cache = new SessionMessagesCache(60000);
        const session = createMockSession();
        await cache.get(/** @type {any} */ (session));
        session.getMessages.mockClear();
        const result2 = await cache.get(/** @type {any} */ (session));
        expect(result2).toHaveLength(2);
        expect(session.getMessages).not.toHaveBeenCalled();
    });

    it('limita o cache de mensagens mantendo as entradas mais recentes', async () => {
        const { SessionMessagesCache } = await import('#copilot/agent/session');
        const cache = new SessionMessagesCache(60000, { maxItems: 2 });
        const session = createMockSession();
        session.getMessages.mockResolvedValueOnce([
            { id: '1', type: 'user', content: 'old', createdAt: 1 },
            { id: '2', type: 'assistant', content: 'mid', createdAt: 2 },
            { id: '3', type: 'user', content: 'new', createdAt: 3 },
        ]);

        const result = await cache.get(/** @type {any} */ (session));

        expect(result).toEqual([
            { id: '2', type: 'assistant', content: 'mid', createdAt: 2 },
            { id: '3', type: 'user', content: 'new', createdAt: 3 },
        ]);
    });

    it('invalidate() limpa o cache', async () => {
        const { SessionMessagesCache } = await import('#copilot/agent/session');
        const cache = new SessionMessagesCache(60000);
        const session = createMockSession();
        await cache.get(/** @type {any} */ (session));
        cache.invalidate();
        session.getMessages.mockClear();
        await cache.get(/** @type {any} */ (session));
        expect(session.getMessages).toHaveBeenCalled();
    });

    it('retorna [] quando getMessages lança erro', async () => {
        const { SessionMessagesCache } = await import('#copilot/agent/session');
        const cache = new SessionMessagesCache(60000);
        const session = createMockSession();
        session.getMessages.mockRejectedValueOnce(new Error('network'));
        const result = await cache.get(/** @type {any} */ (session));
        expect(result).toEqual([]);
    });

    it('syncSdkHistory emite sucesso quando sincroniza histórico do SDK', async () => {
        const { syncSdkHistory } = await import('#copilot/agent/session');
        const session = createMockSession();
        const emit = vi.fn();
        const syncFromSdkHistory = vi.fn(() => ({ synced: 2, skipped: 1 }));

        const result = await syncSdkHistory(/** @type {any} */ (session), emit, {
            getHubSessionId: () => 'hub-1',
            conversationStore: { syncFromSdkHistory },
        });

        expect(result.ok).toBe(true);
        expect(syncFromSdkHistory).toHaveBeenCalledWith('hub-1', 'sess-1', expect.any(Array));
        expect(emit).toHaveBeenCalledWith('session.history_synced', {
            hubSessionId: 'hub-1',
            sessionId: 'sess-1',
            synced: 2,
            skipped: 1,
        });
    });

    it('syncSdkHistory trata ausência de getMessages como capability indisponível, sem falha estrutural', async () => {
        const { syncSdkHistory } = await import('#copilot/agent/session');
        const emit = vi.fn();

        const result = await syncSdkHistory(
            /** @type {any} */ ({ sessionId: 'sess-no-history' }),
            emit,
            {
                getHubSessionId: () => 'hub-1',
                conversationStore: { syncFromSdkHistory: vi.fn() },
            },
            { label: 'session.history.sync', phase: 'resume' },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.unavailableReason).toBe('sdk_getMessages_unavailable');
        }
        expect(emit).not.toHaveBeenCalled();
    });

    it('syncSdkHistory emite falha estruturada quando getMessages explode', async () => {
        const { syncSdkHistory } = await import('#copilot/agent/session');
        const session = createMockSession();
        session.getMessages.mockRejectedValueOnce(new Error('history down'));
        const emit = vi.fn();

        const result = await syncSdkHistory(
            /** @type {any} */ (session),
            emit,
            {
                getHubSessionId: () => 'hub-1',
                conversationStore: { syncFromSdkHistory: vi.fn() },
            },
            { label: 'session.history.sync', phase: 'resume' },
        );

        expect(result.ok).toBe(false);
        expect(emit).toHaveBeenCalledWith(
            'session.history_synced',
            expect.objectContaining({
                ok: false,
                error: 'history down',
                disposition: 'retry',
                sessionId: 'sess-1',
            }),
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. event-wirer.js — wireSessionEvents orchestration
// ═══════════════════════════════════════════════════════════════════════════════

describe('F43 — event-wirer.js wireSessionEvents', () => {
    it('retorna array de unsubscribe functions', async () => {
        const { wireSessionEvents } = await import('#copilot/agent/session/wiring');
        const session = createMockSession();
        const callbacks = {
            emit: vi.fn(),
            getStatusSnapshot: vi.fn(),
            onCheckpointPath: vi.fn(),
            onContextState: vi.fn(),
            onPrInfo: vi.fn(),
            isProcessing: () => false,
            dialogLoopActive: () => false,
        };
        const unsubs = wireSessionEvents(/** @type {any} */ (session), false, callbacks);
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBeGreaterThan(5);
        unsubs.forEach((u) => expect(typeof u).toBe('function'));
    });

    it('unsubscribe functions são chamáveis sem erro', async () => {
        const { wireSessionEvents } = await import('#copilot/agent/session/wiring');
        const session = createMockSession();
        const callbacks = {
            emit: vi.fn(),
            getStatusSnapshot: vi.fn(),
            onCheckpointPath: vi.fn(),
            onContextState: vi.fn(),
            onPrInfo: vi.fn(),
            isProcessing: () => false,
            dialogLoopActive: () => false,
        };
        const unsubs = wireSessionEvents(/** @type {any} */ (session), false, callbacks);
        for (const u of unsubs) {
            expect(() => u()).not.toThrow();
        }
    });
});
