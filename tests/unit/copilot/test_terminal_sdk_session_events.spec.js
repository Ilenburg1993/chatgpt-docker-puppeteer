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

    it('cleanup remove listeners vanilla registrados', async () => {
        const { setupTerminalSdkSessionEventListeners } =
            await import('../../../src/copilot/terminal/sdk-session-events.js');
        const agent = createAgentHost();
        const dispose = setupTerminalSdkSessionEventListeners({ agent, refreshPromptIfIdle: vi.fn() });

        expect(agent.count('session.mode_changed')).toBeGreaterThan(0);
        expect(agent.count('session.workspace_file_changed')).toBeGreaterThan(0);
        dispose();
        expect(agent.count('session.mode_changed')).toBe(0);
        expect(agent.count('session.workspace_file_changed')).toBe(0);
    });
});
