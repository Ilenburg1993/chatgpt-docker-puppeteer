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

vi.mock('../../../../src/copilot/terminal/frontend/projections/sdk-session-vanilla.js', () => ({
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
        expect(ctx.output()).toContain('Plano SDK');
        expect(ctx.output()).toContain('Modo SDK');
        expect(ctx.output()).toContain('interativo');
        expect(ctx.output()).toContain('plan.md');
        expect(ctx.output()).toContain('step 1');
        expect(ctx.output()).not.toContain('INTERACTIVE');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('liga plan mode vanilla via SDK', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'on');

        expect(setTerminalSdkModeProjection).toHaveBeenCalledWith('plan');
        expect(ctx.output()).toContain('Modo SDK');
        expect(ctx.output()).toContain('interativo -> plano');
        expect(ctx.output()).not.toContain('interactive');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('desliga plan mode vanilla via SDK', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'off');

        expect(setTerminalSdkModeProjection).toHaveBeenCalledWith('interactive');
        expect(ctx.output()).toContain('interativo -> interativo');
        expect(ctx.output()).not.toContain('interactive');
        expect(ctx.output()).not.toContain('\x1b[');
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
        expect(ctx.output()).toContain('atualizado');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('faz append ao plan.md vanilla via read + update', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'append - step 2');

        expect(readTerminalSdkSessionProjection).toHaveBeenCalled();
        expect(updateTerminalSdkPlanProjection).toHaveBeenCalledWith('# Plan\n- step 1\n- step 2');
        expect(ctx.output()).toContain('expandido');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('apaga o plan.md vanilla', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, 'clear');

        expect(deleteTerminalSdkPlanProjection).toHaveBeenCalled();
        expect(ctx.output()).toContain('removido');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('encaminha runtimeId explícito para o fluxo vanilla do SDK', async () => {
        const ctx = mockCtx();

        await cmdPlan({ println: ctx.println }, '--runtime alt on');

        expect(setTerminalSdkModeProjection).toHaveBeenCalledWith('plan', 'alt');
    });
});
