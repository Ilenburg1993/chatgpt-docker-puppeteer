// @ts-check
/**
 * tests/unit/copilot/test_terminal_frontend_sdk_session_projection.spec.js
 *
 * Contrato: terminal/frontend/sdk-session-projection.js
 */

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getLastSdkPlanChangedAt: vi.fn(() => 123),
    getLastSdkPlanOperation: vi.fn(() => 'update'),
    deleteTerminalSdkPlan: vi.fn(async () => undefined),
    getTerminalSdkSessionMode: vi.fn(async () => ({ mode: 'interactive' })),
    readTerminalSdkPlan: vi.fn(async () => ({ exists: true, content: '# plan', path: '/tmp/plan.md' })),
    setTerminalSdkSessionMode: vi.fn(async (mode) => ({ mode })),
    updateTerminalSdkPlan: vi.fn(async () => undefined),
}));

vi.mock('../../../src/copilot/terminal/state.js', () => ({
    getLastSdkPlanChangedAt: mocks.getLastSdkPlanChangedAt,
    getLastSdkPlanOperation: mocks.getLastSdkPlanOperation,
}));

vi.mock('../../../src/copilot/terminal/frontend/llm-b-runtime.js', () => ({
    deleteTerminalSdkPlan: mocks.deleteTerminalSdkPlan,
    getTerminalSdkSessionMode: mocks.getTerminalSdkSessionMode,
    readTerminalSdkPlan: mocks.readTerminalSdkPlan,
    setTerminalSdkSessionMode: mocks.setTerminalSdkSessionMode,
    updateTerminalSdkPlan: mocks.updateTerminalSdkPlan,
}));

describe('terminal/frontend/sdk-session-projection.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/frontend/sdk-session-projection.js');
        expect(mod).toBeTruthy();
    });

    it('exporta a superfície vanilla de mode/plan', async () => {
        const mod = await import('../../../src/copilot/terminal/frontend/sdk-session-projection.js');
        expect(typeof mod.readTerminalSdkSessionProjection).toBe('function');
        expect(typeof mod.setTerminalSdkModeProjection).toBe('function');
        expect(typeof mod.updateTerminalSdkPlanProjection).toBe('function');
        expect(typeof mod.deleteTerminalSdkPlanProjection).toBe('function');
    });

    it('readTerminalSdkSessionProjection monta projeção vanilla a partir de runtime + state', async () => {
        const mod = await import('../../../src/copilot/terminal/frontend/sdk-session-projection.js');
        const projection = await mod.readTerminalSdkSessionProjection();

        expect(projection).toEqual({
            currentMode: 'interactive',
            plan: { exists: true, content: '# plan', path: '/tmp/plan.md' },
            lastObservedPlanOperation: 'update',
            lastObservedPlanChangedAt: 123,
        });
    });

    it('set/update/delete projections delegam ao runtime vanilla do SDK', async () => {
        const mod = await import('../../../src/copilot/terminal/frontend/sdk-session-projection.js');

        await expect(mod.setTerminalSdkModeProjection('plan')).resolves.toEqual({
            previousMode: 'interactive',
            currentMode: 'plan',
        });
        expect(mocks.setTerminalSdkSessionMode).toHaveBeenCalledWith('plan');

        await mod.updateTerminalSdkPlanProjection('novo plano');
        expect(mocks.updateTerminalSdkPlan).toHaveBeenCalledWith('novo plano');

        await mod.deleteTerminalSdkPlanProjection();
        expect(mocks.deleteTerminalSdkPlan).toHaveBeenCalled();
    });
});
