// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    getSdkSessionMode: vi.fn(async () => ({ mode: 'interactive' })),
    setSdkSessionMode: vi.fn(async (/** @type {any} */ mode) => ({ mode })),
    readSdkPlan: vi.fn(async () => ({ path: '/tmp/default-plan.md', content: 'default' })),
    updateSdkPlan: vi.fn(async () => ({ ok: true })),
    deleteSdkPlan: vi.fn(async () => ({ ok: true })),
});

const altRuntime = /** @type {any} */ ({
    getSdkSessionMode: vi.fn(async () => ({ mode: 'plan' })),
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
        expect(await runtimeSdkSession.readAgentSdkPlan()).toEqual({
            path: '/tmp/default-plan.md',
            content: 'default',
        });

        await runtimeSdkSession.setAgentSdkSessionMode('plan');
        await runtimeSdkSession.updateAgentSdkPlan('novo plano');
        await runtimeSdkSession.deleteAgentSdkPlan();

        expect(defaultRuntime.setSdkSessionMode).toHaveBeenCalledWith('plan');
        expect(defaultRuntime.updateSdkPlan).toHaveBeenCalledWith('novo plano');
        expect(defaultRuntime.deleteSdkPlan).toHaveBeenCalled();
    });

    it('resolve runtimeId explícito para operações vanilla da sessão SDK', async () => {
        expect(await runtimeSdkSession.getAgentSdkSessionMode('alt')).toEqual({ mode: 'plan' });
        expect(await runtimeSdkSession.readAgentSdkPlan('alt')).toEqual({ path: '/tmp/alt-plan.md', content: 'alt' });

        await runtimeSdkSession.setAgentSdkSessionMode('autopilot', 'alt');
        await runtimeSdkSession.updateAgentSdkPlan('alt plano', 'alt');
        await runtimeSdkSession.deleteAgentSdkPlan('alt');

        expect(altRuntime.setSdkSessionMode).toHaveBeenCalledWith('autopilot');
        expect(altRuntime.updateSdkPlan).toHaveBeenCalledWith('alt plano');
        expect(altRuntime.deleteSdkPlan).toHaveBeenCalled();
    });
});
