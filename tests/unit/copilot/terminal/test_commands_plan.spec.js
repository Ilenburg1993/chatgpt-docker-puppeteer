// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const readTerminalSdkSessionProjection = vi.fn(async () => ({
    currentMode: 'interactive',
    plan: { exists: true, content: '# Plan\n- step 1', path: '/tmp/plan.md' },
    lastObservedPlanOperation: 'update',
    lastObservedPlanChangedAt: 1_717_000_000_000,
}));
const setTerminalSdkModeProjection = vi.fn(async (mode) => ({
    previousMode: 'interactive',
    currentMode: mode,
}));
const updateTerminalSdkPlanProjection = vi.fn(async (content) => ({
    exists: true,
    content,
    path: '/tmp/plan.md',
}));
const deleteTerminalSdkPlanProjection = vi.fn(async () => ({ exists: false, content: null, path: '/tmp/plan.md' }));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalSdkSessionProjection,
    setTerminalSdkModeProjection,
    updateTerminalSdkPlanProjection,
    deleteTerminalSdkPlanProjection,
}));

const { cmdPlan } = await import('../../../../src/copilot/terminal/commands/plan.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/plan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('mostra o estado vanilla de mode e plan do SDK', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, '');

        expect(readTerminalSdkSessionProjection).toHaveBeenCalled();
        expect(ctx.output()).toContain('modo SDK atual');
        expect(ctx.output()).toContain('INTERACTIVE');
        expect(ctx.output()).toContain('plan.md');
        expect(ctx.output()).toContain('step 1');
    });

    it('liga plan mode vanilla via SDK', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'on');

        expect(setTerminalSdkModeProjection).toHaveBeenCalledWith('plan');
        expect(ctx.output()).toContain('Modo SDK: interactive → plan');
    });

    it('desliga plan mode vanilla via SDK', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'off');

        expect(setTerminalSdkModeProjection).toHaveBeenCalledWith('interactive');
        expect(ctx.output()).toContain('Modo SDK: interactive → interactive');
    });

    it('faz read do plan.md vanilla', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'read');

        expect(ctx.output()).toContain('plan.md');
        expect(ctx.output()).toContain('# Plan');
    });

    it('faz set do plan.md vanilla via update', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'set # Novo plano');

        expect(updateTerminalSdkPlanProjection).toHaveBeenCalledWith('# Novo plano');
        expect(ctx.output()).toContain('plan.md atualizado');
    });

    it('faz append ao plan.md vanilla via read + update', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'append - step 2');

        expect(readTerminalSdkSessionProjection).toHaveBeenCalled();
        expect(updateTerminalSdkPlanProjection).toHaveBeenCalledWith('# Plan\n- step 1\n- step 2');
        expect(ctx.output()).toContain('plan.md expandido');
    });

    it('apaga o plan.md vanilla', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'clear');

        expect(deleteTerminalSdkPlanProjection).toHaveBeenCalled();
        expect(ctx.output()).toContain('plan.md removido');
    });
});
