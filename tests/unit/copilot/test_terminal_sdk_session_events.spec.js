// @ts-check
/**
 * tests/unit/copilot/test_terminal_sdk_session_events.spec.js
 *
 * Contrato: terminal/sdk-session-events.js
 */

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    recordTerminalActivity: vi.fn(),
    broadcastSse: vi.fn(),
    println: vi.fn(),
    setLastSdkPlanOperation: vi.fn(),
    setSdkSessionMode: vi.fn(),
    beginTerminalTurnTrace: vi.fn(),
    completeTerminalTurnTrace: vi.fn(),
    recordTerminalTurnFileActivity: vi.fn(),
    recordTerminalTurnToolActivity: vi.fn(),
}));

vi.mock('../../../src/copilot/terminal/activity-state.js', () => ({
    recordTerminalActivity: mocks.recordTerminalActivity,
}));

vi.mock('../../../src/copilot/terminal/dialog/index.js', () => ({
    broadcastSse: mocks.broadcastSse,
    println: mocks.println,
}));

vi.mock('../../../src/copilot/presentation/runtime-ui-state-store.js', () => ({
    setLastSdkPlanOperation: mocks.setLastSdkPlanOperation,
    setSdkSessionMode: mocks.setSdkSessionMode,
}));

vi.mock('../../../src/copilot/terminal/turn-trace-state.js', () => ({
    beginTerminalTurnTrace: mocks.beginTerminalTurnTrace,
    completeTerminalTurnTrace: mocks.completeTerminalTurnTrace,
    recordTerminalTurnFileActivity: mocks.recordTerminalTurnFileActivity,
    recordTerminalTurnToolActivity: mocks.recordTerminalTurnToolActivity,
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
            const index = arr.indexOf(handler);
            if (index >= 0) arr.splice(index, 1);
            listeners.set(event, arr);
        },
        emit(/** @type {string} */ event, /** @type {unknown} */ payload) {
            for (const handler of listeners.get(event) ?? []) handler(payload);
        },
        count(/** @type {string} */ event) {
            return (listeners.get(event) ?? []).length;
        },
    };
}

describe('terminal/sdk-session-events.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/sdk-session-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalSdkSessionEventListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/sdk-session-events.js');
        expect(typeof mod.setupTerminalSdkSessionEventListeners).toBe('function');
    });

    it('reflete session.mode_changed no estado e no SSE vanilla', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('session.mode_changed', { previousMode: 'interactive', newMode: 'plan' });

        expect(mocks.setSdkSessionMode).toHaveBeenCalledWith('plan');
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Modo SDK alterado',
            expect.objectContaining({ detail: 'interactive → plan', source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.mode_changed',
            expect.objectContaining({ previousMode: 'interactive', newMode: 'plan' }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('surfa workspace_file_changed e assistant.turn_start/end para a UX local', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('assistant.turn_start', { turnId: 'turn-1' });
        agent.emit('session.workspace_file_changed', { operation: 'update', path: 'files/plan.md' });
        agent.emit('assistant.turn_end', { turnId: 'turn-1' });

        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.turn_start',
            expect.objectContaining({ turnId: 'turn-1' }),
        );
        expect(mocks.beginTerminalTurnTrace).toHaveBeenCalledWith({ turnId: 'turn-1' });
        expect(mocks.completeTerminalTurnTrace).toHaveBeenCalledWith({ turnId: 'turn-1' });
        expect(mocks.recordTerminalTurnFileActivity).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'files/plan.md', operation: 'edit', source: 'sdk' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.workspace_file_changed',
            expect.objectContaining({ operation: 'update', path: 'files/plan.md' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'assistant.turn_end',
            expect.objectContaining({ turnId: 'turn-1' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Workspace da sessão alterado',
            expect.objectContaining({ detail: 'update · files/plan.md' }),
        );
    });

    it('surfa elicitation, permission e sidechannel SDK como narrativa operacional', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/sdk-session-events.js');
        const agent = createAgentHost();
        const refreshPromptIfIdle = vi.fn();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle });
        agent.emit('elicitation.pending', {
            requestId: 'el-1',
            message: 'Informe a branch de destino',
            mode: 'form',
            actionable: true,
        });
        agent.emit('permission.requested', {
            requestId: 'perm-1',
            permissionType: 'file_write',
        });
        agent.emit('user_input.requested', {
            requestId: 'ui-1',
            question: 'Escolha?',
            choices: ['A', 'B'],
            allowFreeform: false,
        });
        agent.emit('user_input.completed', {
            requestId: 'ui-1',
            answer: 'B',
            wasFreeform: false,
        });
        agent.emit('tool.user_requested', {
            toolName: 'workspace.write',
            requestId: 'tool-1',
        });
        agent.emit('mcp.oauth.required', {
            serverName: 'github',
            requestId: 'oauth-1',
        });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Elicitation SDK pendente',
            expect.objectContaining({ severity: 'warn', source: 'sdk' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'Permissão SDK solicitada',
            expect.objectContaining({ detail: 'file_write · perm-1', severity: 'warn' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'ask_user SDK solicitado',
            expect.objectContaining({ detail: expect.stringContaining('Escolha?'), severity: 'warn' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'question',
            'ask_user SDK respondido',
            expect.objectContaining({ detail: 'ui-1 · choice/protocolo' }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'tool',
            'Tool solicitou ação do usuário',
            expect.objectContaining({ toolName: 'workspace.write', severity: 'warn' }),
        );
        expect(mocks.recordTerminalTurnToolActivity).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: 'workspace.write',
                operation: 'run',
                status: 'user_requested',
            }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'elicitation.pending',
            expect.objectContaining({ id: 'el-1', message: 'Informe a branch de destino' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'permission.requested',
            expect.objectContaining({ id: 'perm-1', permissionType: 'file_write' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.requested',
            expect.objectContaining({ requestId: 'ui-1', allowFreeform: false }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'user_input.completed',
            expect.objectContaining({ requestId: 'ui-1', answer: 'B', wasFreeform: false }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'tool.user_requested',
            expect.objectContaining({ toolName: 'workspace.write', requestId: 'tool-1' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'mcp.oauth.required',
            expect.objectContaining({ serverName: 'github', requestId: 'oauth-1' }),
        );
        expect(refreshPromptIfIdle).toHaveBeenCalled();
    });

    it('surfa loaded/background SDK events para atividade e SSE', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/sdk-session-events.js');
        const agent = createAgentHost();

        setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });
        agent.emit('session.skills_loaded', { count: 3, enabled: 2 });
        agent.emit('session.tools_updated', { count: 92 });
        agent.emit('session.background_tasks_changed', { count: 4 });

        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Skills SDK carregadas',
            expect.objectContaining({ detail: '2/3 habilitada(s)', recordHistory: false }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Tools SDK atualizadas',
            expect.objectContaining({ detail: '92 tool(s)', recordHistory: false }),
        );
        expect(mocks.recordTerminalActivity).toHaveBeenCalledWith(
            'system',
            'Background tasks SDK alteradas',
            expect.objectContaining({ detail: '4 pendente(s)', severity: 'warn' }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.skills_loaded',
            expect.objectContaining({ count: 3, enabled: 2 }),
        );
        expect(mocks.broadcastSse).toHaveBeenCalledWith(
            'session.background_tasks_changed',
            expect.objectContaining({ count: 4 }),
        );
    });

    it('cleanup remove listeners vanilla registrados', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/sdk-session-events.js');
        const agent = createAgentHost();
        const dispose = setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });

        expect(agent.count('session.mode_changed')).toBeGreaterThan(0);
        expect(agent.count('session.workspace_file_changed')).toBeGreaterThan(0);
        expect(agent.count('elicitation.pending')).toBeGreaterThan(0);
        expect(agent.count('permission.requested')).toBeGreaterThan(0);
        expect(agent.count('user_input.requested')).toBeGreaterThan(0);
        expect(agent.count('session.skills_loaded')).toBeGreaterThan(0);
        dispose();
        expect(agent.count('session.mode_changed')).toBe(0);
        expect(agent.count('session.workspace_file_changed')).toBe(0);
        expect(agent.count('elicitation.pending')).toBe(0);
        expect(agent.count('permission.requested')).toBe(0);
        expect(agent.count('user_input.requested')).toBe(0);
        expect(agent.count('session.skills_loaded')).toBe(0);
    });
});
