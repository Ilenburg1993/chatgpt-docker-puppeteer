// @ts-check
/**
 * tests/unit/copilot/agent/test_faixa_b_event_handlers.spec.js
 *
 * Faixa B: Testes para os 4 novos event handler modules:
 *
 * - session-lifecycle.js (B1)
 * - mcp-events.js (B2)
 * - tool-lifecycle.js (B3)
 * - interaction-events.js (B4)
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mocks.log,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock(
    '#copilot/config/env',
    () =>
        new Proxy(
            {
                COPILOT_MCP_SERVERS: '',
                COPILOT_CUSTOM_AGENTS: '',
                COPILOT_DISABLED_AGENTS: '',
                COPILOT_MODEL: 'gpt-4o',
                COPILOT_REASONING_EFFORT: '',
                COPILOT_HUB_SOCKET_AUTH_REQUIRED: false,
                DASHBOARD_SOCKET_AUTH_REQUIRED: false,
                AGENT_MAX_LISTENERS: 100,
                CONTEXT_UTIL_WARN_THRESHOLD: 0.9,
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

// ─── Mock session factory ───────────────────────────────────────────────────

function createMockSession() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();

    const session = {
        sessionId: 'test-sess-1',
        /** @param {string | Function} eventOrHandler @param {Function} [handler] */
        on(eventOrHandler, handler) {
            if (typeof eventOrHandler === 'function') {
                return () => {};
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
            const evtObj = { kind: event, type: event, timestamp: Date.now(), data: data ?? {} };
            for (const fn of listeners.get(event) || []) fn(evtObj);
        },
    };
    return session;
}

// ═══════════════════════════════════════════════════════════════════════════════
// B1 — session-lifecycle.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('Faixa B1 — session-lifecycle handlers', () => {
    it('wireSessionLifecycleEvents retorna array de unsubscribe functions', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBe(11);
        unsubs.forEach((u) => expect(typeof u).toBe('function'));
    });

    it('emite session.info com tipo e mensagem', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.info', { infoType: 'configuration', message: 'streaming on' });
        expect(emit).toHaveBeenCalledWith(
            'session.info',
            expect.objectContaining({ infoType: 'configuration', message: 'streaming on' }),
        );
    });

    it('emite session.idle ao receber evento', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.idle', {});
        expect(emit).toHaveBeenCalledWith('session.idle', expect.objectContaining({ ts: expect.any(Number) }));
    });

    it('emite session.error com errorType e message', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.error', { errorType: 'rate_limit', message: 'Too many requests' });
        expect(emit).toHaveBeenCalledWith(
            'session.error',
            expect.objectContaining({ errorType: 'rate_limit', message: 'Too many requests' }),
        );
    });

    it('loga WARN ao receber session.error', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        mocks.log.mockClear();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.error', { errorType: 'network', message: 'timeout' });
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('session.error'));
    });

    it('emite session.warning', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.warning', { message: 'context truncated' });
        expect(emit).toHaveBeenCalledWith('session.warning', expect.objectContaining({ message: 'context truncated' }));
    });

    it('emite session.model_changed com previousModel e newModel', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.model_change', { previousModel: 'gpt-4o', newModel: 'claude-sonnet-4' });
        expect(emit).toHaveBeenCalledWith(
            'session.model_changed',
            expect.objectContaining({ previousModel: 'gpt-4o', newModel: 'claude-sonnet-4' }),
        );
    });

    it('emite session.tools_updated com count', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.tools_updated', { tools: ['a', 'b', 'c'] });
        expect(emit).toHaveBeenCalledWith(
            'session.tools_updated',
            expect.objectContaining({ count: 3, toolsMaterialized: true, countMaterialized: true }),
        );
    });

    it('emite session.tools_updated sem fabricar count quando SDK não materializa lista/contador', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.tools_updated', {});
        expect(emit).toHaveBeenCalledWith(
            'session.tools_updated',
            expect.objectContaining({ count: 0, toolsMaterialized: false, countMaterialized: false }),
        );
    });

    it('emite session loaded/background events com contadores', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });

        session._emit('session.skills_loaded', {
            skills: [
                { name: 'a', enabled: true },
                { name: 'b', enabled: false },
            ],
        });
        expect(emit).toHaveBeenCalledWith('session.skills_loaded', expect.objectContaining({ count: 2, enabled: 1 }));

        session._emit('session.extensions_loaded', { extensions: ['gh'] });
        expect(emit).toHaveBeenCalledWith('session.extensions_loaded', expect.objectContaining({ count: 1 }));

        session._emit('session.mcp_servers_loaded', { servers: ['github', 'filesystem'] });
        expect(emit).toHaveBeenCalledWith('session.mcp_servers_loaded', expect.objectContaining({ count: 2 }));

        session._emit('session.background_tasks_changed', { pendingCount: 4 });
        expect(emit).toHaveBeenCalledWith('session.background_tasks_changed', expect.objectContaining({ count: 4 }));
    });

    it('emite session.snapshot_rewind', async () => {
        const { wireSessionLifecycleEvents } = await import('#copilot/event-handlers/session-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireSessionLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('session.snapshot_rewind', { snapshotId: 'snap-1' });
        expect(emit).toHaveBeenCalledWith(
            'session.snapshot_rewind',
            expect.objectContaining({ data: expect.any(Object) }),
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2 — mcp-events.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('Faixa B2 — mcp-events handlers', () => {
    it('wireMcpEvents retorna array de 3 unsubscribe functions', async () => {
        const { wireMcpEvents } = await import('#copilot/event-handlers/mcp-events');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireMcpEvents(/** @type {any} */ (session), { emit });
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBe(3);
    });

    it('emite mcp.server.status_changed ao receber evento', async () => {
        const { wireMcpEvents } = await import('#copilot/event-handlers/mcp-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireMcpEvents(/** @type {any} */ (session), { emit });
        session._emit('session.mcp_server_status_changed', { serverName: 'github', status: 'connected' });
        expect(emit).toHaveBeenCalledWith(
            'mcp.server.status_changed',
            expect.objectContaining({ serverName: 'github', status: 'connected' }),
        );
    });

    it('loga WARN quando MCP server falha', async () => {
        const { wireMcpEvents } = await import('#copilot/event-handlers/mcp-events');
        const session = createMockSession();
        const emit = vi.fn();
        mocks.log.mockClear();
        wireMcpEvents(/** @type {any} */ (session), { emit });
        session._emit('session.mcp_server_status_changed', { serverName: 'my-srv', status: 'failed' });
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('MCP server failed'));
    });

    it('emite mcp.oauth.required', async () => {
        const { wireMcpEvents } = await import('#copilot/event-handlers/mcp-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireMcpEvents(/** @type {any} */ (session), { emit });
        session._emit('mcp.oauth_required', { serverName: 'jira', requestId: 'req-1' });
        expect(emit).toHaveBeenCalledWith(
            'mcp.oauth.required',
            expect.objectContaining({ serverName: 'jira', requestId: 'req-1' }),
        );
    });

    it('emite mcp.oauth.completed', async () => {
        const { wireMcpEvents } = await import('#copilot/event-handlers/mcp-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireMcpEvents(/** @type {any} */ (session), { emit });
        session._emit('mcp.oauth_completed', { requestId: 'req-1' });
        expect(emit).toHaveBeenCalledWith('mcp.oauth.completed', expect.objectContaining({ requestId: 'req-1' }));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B3 — tool-lifecycle.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('Faixa B3 — tool-lifecycle handlers', () => {
    it('wireToolLifecycleEvents retorna array de 7 unsubscribe functions', async () => {
        const { wireToolLifecycleEvents } = await import('#copilot/event-handlers/tool-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireToolLifecycleEvents(/** @type {any} */ (session), { emit });
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBe(7);
    });

    it('emite tool.execution_partial_result', async () => {
        const { wireToolLifecycleEvents } = await import('#copilot/event-handlers/tool-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireToolLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('tool.execution_partial_result', { toolCallId: 'tool-9', partialOutput: 'linha parcial' });
        expect(emit).toHaveBeenCalledWith(
            'tool.execution_partial_result',
            expect.objectContaining({ toolCallId: 'tool-9', partialOutput: 'linha parcial' }),
        );
    });

    it('emite tool.execution_progress com payload real do SDK', async () => {
        const { wireToolLifecycleEvents } = await import('#copilot/event-handlers/tool-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireToolLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('tool.execution_progress', {
            toolCallId: 'tool-1',
            toolName: 'run_in_terminal',
            progressMessage: 'Compilando projeto…',
            requestId: 'r1',
        });
        expect(emit).toHaveBeenCalledWith(
            'tool.execution_progress',
            expect.objectContaining({
                toolCallId: 'tool-1',
                toolName: 'run_in_terminal',
                progressMessage: 'Compilando projeto…',
                requestId: 'r1',
            }),
        );
    });

    it('emite tool.user_requested', async () => {
        const { wireToolLifecycleEvents } = await import('#copilot/event-handlers/tool-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireToolLifecycleEvents(/** @type {any} */ (session), { emit });
        session._emit('tool.user_requested', { toolName: 'search', requestId: 'r2' });
        expect(emit).toHaveBeenCalledWith(
            'tool.user_requested',
            expect.objectContaining({ toolName: 'search', requestId: 'r2' }),
        );
    });

    it('emite external_tool.requested/completed no bridge canônico de tools', async () => {
        const { wireToolLifecycleEvents } = await import('#copilot/event-handlers/tool-lifecycle');
        const session = createMockSession();
        const emit = vi.fn();
        wireToolLifecycleEvents(/** @type {any} */ (session), { emit });

        session._emit('external_tool.requested', { toolName: 'browser.open', requestId: 'ext-1' });
        expect(emit).toHaveBeenCalledWith(
            'external_tool.requested',
            expect.objectContaining({ toolName: 'browser.open', requestId: 'ext-1' }),
        );

        session._emit('external_tool.completed', { toolName: 'browser.open', requestId: 'ext-1', success: true });
        expect(emit).toHaveBeenCalledWith(
            'external_tool.completed',
            expect.objectContaining({ toolName: 'browser.open', requestId: 'ext-1', success: true }),
        );
    });

    it('mode-and-tools emite session.mode_changed e session.plan_changed', async () => {
        const { wireModeAndToolEvents } = await import('#copilot/event-handlers/mode-and-tools');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireModeAndToolEvents(/** @type {any} */ (session), { emit });
        expect(unsubs).toHaveLength(2);
        session._emit('session.mode_changed', { previousMode: 'interactive', newMode: 'plan' });
        session._emit('session.plan_changed', { operation: 'update' });
        expect(emit).toHaveBeenCalledWith(
            'session.mode_changed',
            expect.objectContaining({ previousMode: 'interactive', newMode: 'plan' }),
        );
        expect(emit).toHaveBeenCalledWith('session.plan_changed', expect.objectContaining({ operation: 'update' }));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B4 — interaction-events.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('Faixa B4 — interaction-events handlers', () => {
    it('wireInteractionEvents retorna array com cobertura ampliada dos eventos de interação', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        const unsubs = wireInteractionEvents(/** @type {any} */ (session), { emit });
        expect(Array.isArray(unsubs)).toBe(true);
        expect(unsubs.length).toBeGreaterThanOrEqual(24);
    });

    it('emite skill.invoked', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });
        session._emit('skill.invoked', { skillName: 'code-audit' });
        expect(emit).toHaveBeenCalledWith('skill.invoked', expect.objectContaining({ skillName: 'code-audit' }));
    });

    it('emite command.executed ao receber command.execute', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });
        session._emit('command.execute', { commandName: '/fix' });
        expect(emit).toHaveBeenCalledWith('command.executed', expect.objectContaining({ commandName: '/fix' }));
    });

    it('emite command.queued e command.completed', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });
        session._emit('command.queued', { requestId: 'cmd-1' });
        expect(emit).toHaveBeenCalledWith('command.queued', expect.objectContaining({ requestId: 'cmd-1' }));
        session._emit('command.completed', { requestId: 'cmd-1' });
        expect(emit).toHaveBeenCalledWith('command.completed', expect.objectContaining({ requestId: 'cmd-1' }));
    });

    it('emite hooks, commands.changed e capabilities.changed com payload normalizado', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        /** @type {any} */ (session).capabilities = { ui: { elicitation: true } };

        wireInteractionEvents(/** @type {any} */ (session), { emit });

        session._emit('hook.start', { hookInvocationId: 'hk-1', hookType: 'preToolUse', input: { tool: 'grep' } });
        expect(emit).toHaveBeenCalledWith(
            'hook.start',
            expect.objectContaining({ hookInvocationId: 'hk-1', hookType: 'preToolUse' }),
        );

        session._emit('hook.end', {
            hookInvocationId: 'hk-1',
            hookType: 'preToolUse',
            success: false,
            error: { message: 'boom' },
        });
        expect(emit).toHaveBeenCalledWith(
            'hook.end',
            expect.objectContaining({ hookInvocationId: 'hk-1', hookType: 'preToolUse', success: false }),
        );

        session._emit('commands.changed', {
            commands: [
                { name: '/plan', description: 'Open plan mode' },
                { name: '/auto', description: 'Switch to auto mode' },
            ],
        });
        expect(emit).toHaveBeenCalledWith(
            'commands.changed',
            expect.objectContaining({
                count: 2,
                commands: expect.arrayContaining([expect.objectContaining({ name: '/plan' })]),
            }),
        );

        session._emit('capabilities.changed', { ui: { elicitation: true } });
        expect(emit).toHaveBeenCalledWith(
            'capabilities.changed',
            expect.objectContaining({
                capabilities: expect.objectContaining({ ui: expect.objectContaining({ elicitation: true }) }),
                changes: expect.objectContaining({ ui: expect.objectContaining({ elicitation: true }) }),
            }),
        );
    });

    it('emite sampling, auto_mode_switch e exit_plan_mode.requested', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();

        wireInteractionEvents(/** @type {any} */ (session), { emit });

        session._emit('sampling.requested', { requestId: 'sample-1', serverName: 'browser', mcpRequestId: 7 });
        expect(emit).toHaveBeenCalledWith(
            'sampling.requested',
            expect.objectContaining({ requestId: 'sample-1', serverName: 'browser', mcpRequestId: 7 }),
        );

        session._emit('sampling.completed', { requestId: 'sample-1' });
        expect(emit).toHaveBeenCalledWith('sampling.completed', expect.objectContaining({ requestId: 'sample-1' }));

        session._emit('auto_mode_switch.requested', { requestId: 'auto-1', errorCode: 'rate_limit' });
        expect(emit).toHaveBeenCalledWith(
            'auto_mode_switch.requested',
            expect.objectContaining({ requestId: 'auto-1', errorCode: 'rate_limit' }),
        );

        session._emit('auto_mode_switch.completed', { requestId: 'auto-1', response: 'yes_always' });
        expect(emit).toHaveBeenCalledWith(
            'auto_mode_switch.completed',
            expect.objectContaining({ requestId: 'auto-1', response: 'yes_always' }),
        );

        session._emit('exit_plan_mode.requested', {
            requestId: 'plan-2',
            recommendedAction: 'approve',
            actions: ['approve', 'edit', 'reject'],
            planContent: '# Plano\n\nFazer rollout',
        });
        expect(emit).toHaveBeenCalledWith(
            'exit_plan_mode.requested',
            expect.objectContaining({
                requestId: 'plan-2',
                recommendedAction: 'approve',
                actions: ['approve', 'edit', 'reject'],
            }),
        );
    });

    it('emite exit_plan_mode.completed', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });
        session._emit('exit_plan_mode.completed', { requestId: 'plan-1' });
        expect(emit).toHaveBeenCalledWith('exit_plan_mode.completed', expect.objectContaining({ requestId: 'plan-1' }));
    });

    it('emite permission.requested e permission.completed', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });
        session._emit('permission.requested', { permissionType: 'file_write' });
        expect(emit).toHaveBeenCalledWith(
            'permission.requested',
            expect.objectContaining({ permissionType: 'file_write' }),
        );
        session._emit('permission.completed', { granted: true });
        expect(emit).toHaveBeenCalledWith('permission.completed', expect.objectContaining({ granted: true }));
    });

    it('emite user_input.requested e user_input.completed conforme contrato SDK', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });

        session._emit('user_input.requested', {
            requestId: 'ui-1',
            question: 'Escolha?',
            choices: ['A', 'B'],
            allowFreeform: false,
            toolCallId: 'tool-1',
        });
        expect(emit).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({
                requestId: 'ui-1',
                question: 'Escolha?',
                choices: ['A', 'B'],
                allowFreeform: false,
                toolCallId: 'tool-1',
            }),
        );

        session._emit('user_input.completed', { requestId: 'ui-1', answer: 'B', wasFreeform: false });
        expect(emit).toHaveBeenCalledWith(
            'user_input.completed',
            expect.objectContaining({ requestId: 'ui-1', answer: 'B', wasFreeform: false }),
        );
    });

    it('emite subagent lifecycle events', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });

        session._emit('subagent.started', { agentName: 'search-agent' });
        expect(emit).toHaveBeenCalledWith('subagent.started', expect.objectContaining({ agentName: 'search-agent' }));

        session._emit('subagent.completed', { agentName: 'search-agent' });
        expect(emit).toHaveBeenCalledWith('subagent.completed', expect.objectContaining({ agentName: 'search-agent' }));

        session._emit('subagent.failed', { agentName: 'search-agent', error: 'timeout' });
        expect(emit).toHaveBeenCalledWith(
            'subagent.failed',
            expect.objectContaining({ agentName: 'search-agent', error: 'timeout' }),
        );

        session._emit('subagent.selected', { agentName: 'code-agent' });
        expect(emit).toHaveBeenCalledWith('subagent.selected', expect.objectContaining({ agentName: 'code-agent' }));

        session._emit('subagent.deselected', { agentName: 'code-agent' });
        expect(emit).toHaveBeenCalledWith('subagent.deselected', expect.objectContaining({ agentName: 'code-agent' }));
    });

    it('emite pending_messages.modified para UX/observabilidade', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        wireInteractionEvents(/** @type {any} */ (session), { emit });

        session._emit('pending_messages.modified', { count: 2 });
        expect(emit).toHaveBeenCalledWith('pending_messages.modified', expect.objectContaining({ count: 2 }));
    });

    it('loga WARN ao receber subagent.failed', async () => {
        const { wireInteractionEvents } = await import('#copilot/event-handlers/interaction-events');
        const session = createMockSession();
        const emit = vi.fn();
        mocks.log.mockClear();
        wireInteractionEvents(/** @type {any} */ (session), { emit });
        session._emit('subagent.failed', { agentName: 'broken', error: 'crash' });
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('subagent.failed'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: wireSessionEvents inclui novos handlers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Faixa B — wireSessionEvents integração', () => {
    it('wireSessionEvents retorna mais unsubs que antes (inclui novos handlers)', async () => {
        const { wireSessionEvents } = await import('#copilot/agent/session/wiring');
        const session = createMockSession();
        const callbacks = {
            emit: vi.fn(),
            getStatusSnapshot: vi.fn(() => ({})),
            onCheckpointPath: vi.fn(),
            onContextState: vi.fn(),
            onPrInfo: vi.fn(),
            isProcessing: vi.fn(() => false),
            dialogLoopActive: vi.fn(() => false),
        };
        const unsubs = wireSessionEvents(/** @type {any} */ (session), false, /** @type {any} */ (callbacks));
        // Alguns handlers retornam unsubscribe composto; o contrato é cobertura ampla sem depender de contagem interna.
        expect(unsubs.length).toBeGreaterThan(35);
    });

    it('novos handlers propagam eventos via callbacks.emit', async () => {
        const { wireSessionEvents } = await import('#copilot/agent/session/wiring');
        const session = createMockSession();
        const emit = vi.fn();
        const callbacks = {
            emit,
            getStatusSnapshot: vi.fn(() => ({})),
            onCheckpointPath: vi.fn(),
            onContextState: vi.fn(),
            onPrInfo: vi.fn(),
            isProcessing: vi.fn(() => false),
            dialogLoopActive: vi.fn(() => false),
        };
        wireSessionEvents(/** @type {any} */ (session), false, /** @type {any} */ (callbacks));

        // Testar um evento de cada novo handler
        session._emit('session.idle', {});
        expect(emit).toHaveBeenCalledWith('session.idle', expect.any(Object));

        session._emit('session.mcp_server_status_changed', { serverName: 'x', status: 'connected' });
        expect(emit).toHaveBeenCalledWith('mcp.server.status_changed', expect.any(Object));

        session._emit('tool.execution_progress', { toolName: 'test', progress: 75 });
        expect(emit).toHaveBeenCalledWith('tool.execution_progress', expect.any(Object));

        session._emit('skill.invoked', { skillName: 'test-skill' });
        expect(emit).toHaveBeenCalledWith('skill.invoked', expect.any(Object));
    });
});
