// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    getSdkSessionMode: vi.fn(async () => ({ mode: 'interactive' })),
    getSdkSessionCapabilities: vi.fn(() => ({ ui: { elicitation: true } })),
    isSdkSessionUiElicitationAvailable: vi.fn(() => true),
    confirmSdkSessionUi: vi.fn(async () => true),
    selectSdkSessionUi: vi.fn(async (_message, options) => options[0] ?? null),
    inputSdkSessionUi: vi.fn(async (message) => `${message}:default`),
    setSdkSessionMode: vi.fn(async (/** @type {any} */ mode) => ({ mode })),
    readSdkPlan: vi.fn(async () => ({ path: '/tmp/default-plan.md', content: 'default' })),
    updateSdkPlan: vi.fn(async () => ({ ok: true })),
    deleteSdkPlan: vi.fn(async () => ({ ok: true })),
});

const altRuntime = /** @type {any} */ ({
    getSdkSessionMode: vi.fn(async () => ({ mode: 'plan' })),
    getSdkSessionCapabilities: vi.fn(() => ({ ui: { elicitation: false } })),
    isSdkSessionUiElicitationAvailable: vi.fn(() => false),
    confirmSdkSessionUi: vi.fn(async () => false),
    selectSdkSessionUi: vi.fn(async (_message, options) => options.at(-1) ?? null),
    inputSdkSessionUi: vi.fn(async (message) => `${message}:alt`),
    setSdkSessionMode: vi.fn(async (/** @type {any} */ mode) => ({ mode })),
    readSdkPlan: vi.fn(async () => ({ path: '/tmp/alt-plan.md', content: 'alt' })),
    updateSdkPlan: vi.fn(async () => ({ ok: true })),
    deleteSdkPlan: vi.fn(async () => ({ ok: true })),
});

vi.mock('../../../src/copilot/presentation/agent-runtime.js', () => ({
    getAgentRuntimeOrDefault: (/** @type {string | null | undefined} */ runtimeId) =>
        runtimeId === 'alt' ? altRuntime : defaultRuntime,
}));

const runtimeSdkSession = await import('../../../src/copilot/presentation/runtime-sdk-session.js');

describe('presentation/runtime-sdk-session', () => {
    it('lê e altera mode/plan no runtime default', async () => {
        expect(await runtimeSdkSession.getAgentSdkSessionMode()).toEqual({ mode: 'interactive' });
        expect(runtimeSdkSession.getAgentSdkSessionCapabilities()).toEqual({ ui: { elicitation: true } });
        expect(runtimeSdkSession.isAgentSdkSessionUiElicitationAvailable()).toBe(true);
        expect(await runtimeSdkSession.readAgentSdkPlan()).toEqual({
            path: '/tmp/default-plan.md',
            content: 'default',
        });
        await expect(runtimeSdkSession.confirmAgentSdkSessionUi('Confirma?')).resolves.toBe(true);
        await expect(runtimeSdkSession.selectAgentSdkSessionUi('Selecione', ['dev', 'prod'])).resolves.toBe('dev');
        await expect(runtimeSdkSession.inputAgentSdkSessionUi('Nome?')).resolves.toBe('Nome?:default');

        await runtimeSdkSession.setAgentSdkSessionMode('plan');
        await runtimeSdkSession.updateAgentSdkPlan('novo plano');
        await runtimeSdkSession.deleteAgentSdkPlan();

        expect(defaultRuntime.setSdkSessionMode).toHaveBeenCalledWith('plan');
        expect(defaultRuntime.updateSdkPlan).toHaveBeenCalledWith('novo plano');
        expect(defaultRuntime.deleteSdkPlan).toHaveBeenCalled();
    });

    it('resolve runtimeId explícito para operações vanilla da sessão SDK', async () => {
        expect(await runtimeSdkSession.getAgentSdkSessionMode('alt')).toEqual({ mode: 'plan' });
        expect(runtimeSdkSession.getAgentSdkSessionCapabilities('alt')).toEqual({ ui: { elicitation: false } });
        expect(runtimeSdkSession.isAgentSdkSessionUiElicitationAvailable('alt')).toBe(false);
        expect(await runtimeSdkSession.readAgentSdkPlan('alt')).toEqual({ path: '/tmp/alt-plan.md', content: 'alt' });
        await expect(runtimeSdkSession.confirmAgentSdkSessionUi('Confirma?', 'alt')).resolves.toBe(false);
        await expect(runtimeSdkSession.selectAgentSdkSessionUi('Selecione', ['dev', 'prod'], 'alt')).resolves.toBe(
            'prod',
        );
        await expect(runtimeSdkSession.inputAgentSdkSessionUi('Nome?', undefined, 'alt')).resolves.toBe('Nome?:alt');

        await runtimeSdkSession.setAgentSdkSessionMode('autopilot', 'alt');
        await runtimeSdkSession.updateAgentSdkPlan('alt plano', 'alt');
        await runtimeSdkSession.deleteAgentSdkPlan('alt');

        expect(altRuntime.setSdkSessionMode).toHaveBeenCalledWith('autopilot');
        expect(altRuntime.updateSdkPlan).toHaveBeenCalledWith('alt plano');
        expect(altRuntime.deleteSdkPlan).toHaveBeenCalled();
    });
});
