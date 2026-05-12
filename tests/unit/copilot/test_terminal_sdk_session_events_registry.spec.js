// @ts-check
/**
 * tests/unit/copilot/test_terminal_sdk_session_events_registry.spec.js
 *
 * Testa a integração de ToolCallRegistry com sdk-session-events.js.
 *
 * Cobre:
 *
 * - external_tool.requested registra no registry
 * - external_tool.completed completa no registry e resolve o nome real
 * - session.shutdown chama registry.clear()
 * - fallback para Maps globais quando registry não é fornecido
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolCallRegistry } from '../../../src/copilot/terminal/state/tool-call-registry.js';

const mocks = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    broadcastSse: vi.fn(),
    println: vi.fn(),
    setLastSdkPlanOperation: vi.fn(),
    setSdkSessionMode: vi.fn(),
    getShowSessionActivity: vi.fn(() => false),
    getShowToolActivity: vi.fn(() => true),
    consumeRuntimeInterventionMailbox: /** @type {any} */ (vi.fn(() => null)),
    enqueueRuntimeInterventionMailbox: vi.fn(),
    readRuntimeInterventionMailboxSummary: vi.fn(() => ({ queueSize: 0, dropped: 0, runtimeId: 'default' })),
    answerTerminalPendingQuestion: vi.fn(() => true),
    beginTerminalTurnTrace: vi.fn(),
    completeTerminalTurnTrace: vi.fn(() => null),
    recordTerminalTurnFileActivity: vi.fn(),
    recordTerminalTurnToolActivity: vi.fn(),
    getTerminalDetailLevel: vi.fn(() => 'detailed'),
    recordTerminalUserInputRequested: vi.fn((evt) => ({
        id: evt?.requestId ?? 'ui-1',
        question: evt?.question ?? '(sem pergunta)',
        kind: 'question',
    })),
    recordTerminalUserInputCompleted: vi.fn(() => null),
}));

vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    recordTerminalActivity: mocks.recordTerminalActivity,
}));
vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse: mocks.broadcastSse,
    println: mocks.println,
}));
vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    setLastSdkPlanOperation: mocks.setLastSdkPlanOperation,
    setSdkSessionMode: mocks.setSdkSessionMode,
    getShowSessionActivity: mocks.getShowSessionActivity,
    getShowToolActivity: mocks.getShowToolActivity,
    consumeRuntimeInterventionMailbox: mocks.consumeRuntimeInterventionMailbox,
    enqueueRuntimeInterventionMailbox: mocks.enqueueRuntimeInterventionMailbox,
    readRuntimeInterventionMailboxSummary: mocks.readRuntimeInterventionMailboxSummary,
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    answerTerminalPendingQuestion: mocks.answerTerminalPendingQuestion,
    drainMailboxToTurnIfIdle: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/state/turn-trace-state.js', () => ({
    beginTerminalTurnTrace: mocks.beginTerminalTurnTrace,
    completeTerminalTurnTrace: mocks.completeTerminalTurnTrace,
    recordTerminalTurnFileActivity: mocks.recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity: mocks.recordTerminalTurnToolActivity,
}));
vi.mock('../../../src/copilot/terminal/state/ui-preferences.js', () => ({
    getTerminalDetailLevel: mocks.getTerminalDetailLevel,
}));
vi.mock('../../../src/copilot/terminal/state/ui-theme.js', () => ({
    terminalThemeBadge: vi.fn((_, label) => `[${label}]`),
    terminalThemeText: vi.fn((_, text) => text),
}));
vi.mock('../../../src/copilot/terminal/state/sdk-interactions.js', async () => {
    const actual = await vi.importActual('../../../src/copilot/terminal/state/sdk-interactions.js');
    return {
        ...actual,
        recordTerminalUserInputRequested: mocks.recordTerminalUserInputRequested,
        recordTerminalUserInputCompleted: mocks.recordTerminalUserInputCompleted,
        recordTerminalElicitationPending: vi.fn((e) => ({
            id: e?.requestId ?? 'el-1',
            message: e?.message ?? '',
            mode: 'form',
            url: null,
            actionable: false,
        })),
        recordTerminalElicitationCompleted: vi.fn(() => null),
        recordTerminalPermissionRequested: vi.fn((e) => ({
            id: 'p-1',
            permissionType: e?.permissionType ?? 'unknown',
            requestId: e?.requestId ?? null,
        })),
        recordTerminalPermissionCompleted: vi.fn(() => null),
        recordTerminalPermissionModeChanged: vi.fn(),
    };
});
vi.mock('../../../src/copilot/terminal/sdk/session/permission-events.js', () => ({
    classifyPermissionDecision: vi.fn(() => 'granted'),
}));
vi.mock('../../../src/copilot/terminal/mailbox-drain.js', () => ({
    drainMailboxToTurnIfIdle: vi.fn(),
}));
vi.mock('../../../src/copilot/dialog/protocol.js', () => ({
    DialogProtocol: { classify: vi.fn(() => 'question') },
}));

function createAgentHost() {
    /** @type {Map<string, Function[]>} */
    const listeners = new Map();
    return {
        on(/** @type {string} */ event, /** @type {(...args: any[]) => void} */ handler) {
            const arr = listeners.get(event) ?? [];
            arr.push(handler);
            listeners.set(event, arr);
        },
        off(/** @type {string} */ event, /** @type {(...args: any[]) => void} */ handler) {
            const arr = listeners.get(event) ?? [];
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
            listeners.set(event, arr);
        },
        emit(/** @type {string} */ event, /** @type {unknown} */ payload) {
            for (const handler of listeners.get(event) ?? []) handler(payload);
        },
    };
}

describe('sdk-session-events.js — integração com ToolCallRegistry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('onExternalToolRequested registra no registry quando fornecido', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const registry = createToolCallRegistry();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn(), registry });
        agent.emit('external_tool.requested', { toolName: 'browser_action', requestId: 'req-001' });

        expect(registry.isNameInFlight('browser_action')).toBe(true);
        const entry = registry.resolveByRequestId('req-001');
        expect(entry?.toolName).toBe('browser_action');
        expect(entry?.kind).toBe('external');
        expect(mocks.println).toHaveBeenCalledWith(expect.stringContaining('[TOOL]'));
    });

    it('onExternalToolCompleted completa no registry e emite SSE correto', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const registry = createToolCallRegistry();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn(), registry });

        agent.emit('external_tool.requested', { toolName: 'github_api', requestId: 'req-002' });
        expect(registry.isNameInFlight('github_api')).toBe(true);

        agent.emit('external_tool.completed', {
            toolName: 'external_tool', // nome genérico do SDK
            requestId: 'req-002',
            success: true,
        });

        // Após completed, deve sair do in-flight e entrar em recently-completed
        expect(registry.isNameInFlight('github_api')).toBe(false);
        expect(registry.wasRecentlyCompleted(expect.any(String), 'req-002')).toBe(true);

        // O evento canônico deve ter o nome real (github_api), não o genérico (external_tool)
        const sseCall = mocks.broadcastSse.mock.calls.find(
            ([event, payload]) => event === 'tool.lifecycle' && payload?.type === 'external_completed',
        );
        expect(sseCall).toBeDefined();
        expect(sseCall?.[1]?.toolName).toBe('github_api');
    });

    it('onSessionShutdown chama registry.clear()', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const agent = createAgentHost();
        const registry = createToolCallRegistry();
        const clearSpy = vi.spyOn(registry, 'clear');

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn(), registry });

        agent.emit('external_tool.requested', { toolName: 'some_tool', requestId: 'req-003' });
        expect(registry.isNameInFlight('some_tool')).toBe(true);

        agent.emit('session.shutdown', { shutdownType: 'graceful' });

        expect(clearSpy).toHaveBeenCalled();
        expect(registry.isNameInFlight('some_tool')).toBe(false);
    });

    it('sem registry injetado, cria registry interno e tracking funciona normalmente', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/events/sdk-session-events.js');
        const { createToolCallRegistry } = await import('../../../src/copilot/terminal/state/tool-call-registry.js');
        const agent = createAgentHost();

        // Sem passar registry — registry interno é criado automaticamente
        const cleanup = setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });

        // O evento deve ser tratado sem errors (não lança exceção)
        expect(() =>
            agent.emit('external_tool.requested', {
                toolName: 'self_tool',
                requestId: 'req-self',
                toolCallId: 'tc-self-1',
            }),
        ).not.toThrow();

        // Cleanup via shutdown
        agent.emit('session.shutdown', { shutdownType: 'graceful' });
        cleanup();

        // Registry com registry explícito após shutdown deve estar limpo
        const registry = createToolCallRegistry();
        const setup2 = setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn(), registry });
        agent.emit('external_tool.requested', { toolName: 'tool2', requestId: 'req2', toolCallId: 'tc-2' });
        expect(registry.isNameInFlight('tool2')).toBe(true);
        agent.emit('session.shutdown', { shutdownType: 'graceful' });
        setup2();
        expect(registry.isNameInFlight('tool2')).toBe(false);
    });
});
