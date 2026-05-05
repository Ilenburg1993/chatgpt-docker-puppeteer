// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const agent = {
        status: 'idle',
        dialogLoopActive: false,
        dialogPaused: false,
        pendingQuestion: null,
        startDialogLoop: vi.fn(async () => {}),
        sendDialogTurn: vi.fn(async (message) => `reply:${message}`),
        stopDialogLoop: vi.fn(async () => {}),
        recoverDialogInputChannel: vi.fn(async () => ({
            recovered: true,
            reason: 'input_channel_missing',
            strategy: 'restart_with_pr',
            prConsumed: true,
            durationMs: 1,
        })),
    };
    return { agent };
});

vi.mock('../../../src/copilot/presentation/runtime-controls.js', () => ({
    getDefaultAgentRuntimeControlsTarget: () => mocks.agent,
}));

describe('presentation/runtime-dialog.js', () => {
    beforeEach(() => {
        mocks.agent.dialogLoopActive = false;
        mocks.agent.dialogPaused = false;
        mocks.agent.status = 'idle';
        mocks.agent.pendingQuestion = null;
        mocks.agent.startDialogLoop.mockClear();
        mocks.agent.sendDialogTurn.mockClear();
        mocks.agent.stopDialogLoop.mockClear();
        mocks.agent.recoverDialogInputChannel.mockClear();
    });

    it('inicia o dialog loop quando inativo e não pausado', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');
        const reply = await mod.sendRuntimeDialogTurn('oi', 'user');

        expect(mocks.agent.startDialogLoop).toHaveBeenCalledTimes(1);
        expect(mocks.agent.sendDialogTurn).toHaveBeenCalledWith('oi');
        expect(reply).toBe('reply:oi');
    });

    it('propaga options para sendDialogTurn e permite start explícito', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');

        await mod.startRuntimeDialogLoop('boot');
        await mod.sendRuntimeDialogTurn('oi', 'user', { timeout: 2000 });

        expect(mocks.agent.startDialogLoop).toHaveBeenCalledWith('boot');
        expect(mocks.agent.sendDialogTurn).toHaveBeenCalledWith('oi', { timeout: 2000 });
    });

    it('não inicia o loop quando o runtime está pausado', async () => {
        mocks.agent.dialogPaused = true;
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');
        await mod.sendRuntimeDialogTurn('oi', 'llm-a');

        expect(mocks.agent.startDialogLoop).not.toHaveBeenCalled();
        expect(mocks.agent.sendDialogTurn).toHaveBeenCalledWith('oi');
    });

    it('pede recovery semântico ao Agent quando o loop está ativo, idle e sem pending READY', async () => {
        mocks.agent.dialogLoopActive = true;
        mocks.agent.status = 'idle';
        mocks.agent.pendingQuestion = null;
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');

        await mod.sendRuntimeDialogTurn('oi', 'llm-a', { traceId: 't1' });

        expect(mocks.agent.recoverDialogInputChannel).toHaveBeenCalledWith({
            reason: 'input_channel_missing',
            traceId: 't1',
        });
        expect(mocks.agent.stopDialogLoop).not.toHaveBeenCalled();
        expect(mocks.agent.startDialogLoop).not.toHaveBeenCalled();
        expect(mocks.agent.sendDialogTurn).toHaveBeenCalledWith('oi', { traceId: 't1' });
    });

    it('expõe diagnósticos estruturados do turno quando auto-starta o loop', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');

        const result = await mod.sendRuntimeDialogTurnWithDiagnostics('oi', 'llm-a', {
            timeout: null,
            traceId: 'diag-1',
        });

        expect(result.reply).toBe('reply:oi');
        expect(result.diagnostics.traceId).toBe('diag-1');
        expect(result.diagnostics.autoStarted).toBe(true);
        expect(result.diagnostics.autoStartDurationMs).toBeGreaterThanOrEqual(0);
        expect(result.diagnostics.recoveredInputChannel).toBe(false);
        expect(result.diagnostics.initialState.dialogLoopActive).toBe(false);
        expect(result.diagnostics.finalState.dialogLoopActive).toBe(false);
        expect(result.diagnostics.dispatchDurationMs).toBeGreaterThanOrEqual(0);
        expect(result.diagnostics.totalDurationMs).toBeGreaterThanOrEqual(result.diagnostics.dispatchDurationMs);
        expect(mocks.agent.sendDialogTurn).toHaveBeenCalledWith('oi', { timeout: null, traceId: 'diag-1' });
    });

    it('anexa injectDiagnostics ao erro quando o envio falha', async () => {
        mocks.agent.dialogLoopActive = true;
        mocks.agent.status = 'idle';
        mocks.agent.sendDialogTurn.mockRejectedValueOnce(new Error('boom'));
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');

        await expect(
            mod.sendRuntimeDialogTurnWithDiagnostics('oi', 'system', {
                traceId: 'diag-error',
            }),
        ).rejects.toMatchObject({
            message: 'boom',
            injectDiagnostics: expect.objectContaining({
                traceId: 'diag-error',
                from: 'system',
                recoveredInputChannel: true,
            }),
        });
    });

    it('encerra o dialog loop com autorização explícita', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');

        await mod.stopRuntimeDialogLoopAuthorized();

        expect(mocks.agent.stopDialogLoop).toHaveBeenCalledWith({ authorized: true });
    });
});
