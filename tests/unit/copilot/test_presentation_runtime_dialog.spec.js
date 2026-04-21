// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const agent = {
        dialogLoopActive: false,
        dialogPaused: false,
        startDialogLoop: vi.fn(async () => {}),
        sendDialogTurn: vi.fn(async (message) => `reply:${message}`),
        stopDialogLoop: vi.fn(async () => {}),
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
        mocks.agent.startDialogLoop.mockClear();
        mocks.agent.sendDialogTurn.mockClear();
        mocks.agent.stopDialogLoop.mockClear();
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

    it('encerra o dialog loop com autorização explícita', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-dialog.js');

        await mod.stopRuntimeDialogLoopAuthorized();

        expect(mocks.agent.stopDialogLoop).toHaveBeenCalledWith({ authorized: true });
    });
});
