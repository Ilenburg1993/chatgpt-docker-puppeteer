// @ts-check

import { describe, expect, it, vi } from 'vitest';

const createRuntimeSnapshot = vi.fn((/** @type {Record<string, unknown>} */ input) => ({
    snapshotId: 'snap-1',
    ...input,
}));
const saveRuntimeSnapshot = vi.fn(async () => '/tmp/snap-1.json');
const listRuntimeSnapshots = vi.fn(async () => [{ snapshotId: 'snap-1' }]);
const loadRuntimeSnapshot = vi.fn(async () => ({ snapshotId: 'snap-1' }));
const setRuntimeBackgroundCompactionThreshold = vi.fn();
const getRuntimeHandoffManager = vi.fn(() => ({ getHistory: () => [{ id: 'h-1' }] }));
const getRuntimeHandoffHistory = vi.fn(() => [{ id: 'h-1' }]);
const stopAgentDialogLoopAuthorized = vi.fn(async () => {});
const pauseDialogLoop = vi.fn(async () => {});
const resumeDialogLoop = vi.fn(async () => {});
const stopDialogLoop = vi.fn(async () => {});
const pingDialogWatchdog = vi.fn();
const altPauseDialogLoop = vi.fn(async () => {});
const altResumeDialogLoop = vi.fn(async () => {});
const altPingDialogWatchdog = vi.fn();

const snapshotInput = {
    sessionId: 'sdk-1',
    model: 'gpt-5',
    status: 'idle',
    sendCount: 3,
    dialogLoopActive: true,
    dialogPaused: false,
    pendingQuestion: null,
};

const snapshotRecord = {
    snapshotId: 'snap-1',
    createdAt: Date.now(),
    sessionId: 'sdk-1',
    model: 'gpt-5',
    status: 'idle',
    sendCount: 3,
    dialogLoopActive: true,
    dialogPaused: false,
    pendingQuestion: null,
    pendingQuestionMeta: null,
    pendingQuestionShadow: null,
    stateSnapshot: null,
    prMetrics: null,
    reason: 'manual',
};

const defaultRuntime = /** @type {any} */ ({
    pauseDialogLoop,
    resumeDialogLoop,
    stopDialogLoop,
    pingDialogWatchdog,
    getHandoffManager: getRuntimeHandoffManager,
});

const altRuntime = /** @type {any} */ ({
    pauseDialogLoop: altPauseDialogLoop,
    resumeDialogLoop: altResumeDialogLoop,
    pingDialogWatchdog: altPingDialogWatchdog,
    getHandoffManager: getRuntimeHandoffManager,
});

vi.mock('#copilot/agent', () => ({
    abortRuntimeCurrentMessage: vi.fn(async () => {}),
    answerRuntimePendingQuestion: vi.fn((runtime, answer) => runtime.answerPendingQuestion?.(answer) ?? false),
    clearRuntimePendingQuestionShadow: vi.fn((runtime) => runtime.clearPendingQuestionShadow?.() ?? false),
    createRuntimeSnapshot,
    saveRuntimeSnapshot,
    listRuntimeSnapshots,
    loadRuntimeSnapshot,
    offRuntimeEvent: vi.fn((runtime, event, handler) => runtime.off?.(event, handler)),
    onRuntimeEvent: vi.fn((runtime, event, handler) => runtime.on?.(event, handler)),
    onceRuntimeEvent: vi.fn((runtime, event, handler) => runtime.once?.(event, handler)),
    pauseRuntimeDialogLoop: vi.fn(async (runtime) => runtime.pauseDialogLoop?.()),
    readRuntimeControlState: vi.fn((runtime) => ({
        status: runtime.status ?? 'idle',
        model: runtime.model ?? 'unknown',
        reasoningEffort: runtime.reasoningEffort ?? 'off',
        sessionId: runtime.sessionId ?? null,
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        dialogPaused: Boolean(runtime.dialogPaused),
        queueSize: runtime.queueSize ?? 0,
    })),
    resumeRuntimeDialogLoop: vi.fn(async (runtime) => runtime.resumeDialogLoop?.()),
    setRuntimeBackgroundCompactionThreshold,
    startRuntime: vi.fn(async (runtime) => runtime.start?.()),
    getRuntimeHandoffManager,
    getRuntimeHandoffHistory,
    stopAgentDialogLoopAuthorized,
}));

vi.mock('../../../src/copilot/presentation/agent/runtime/index.js', () => ({
    getDefaultAgentRuntime: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getAgentRuntime: (/** @type {string | null | undefined} */ runtimeId) =>
        runtimeId === 'alt' ? altRuntime : defaultRuntime,
    requireAgentRuntime: (/** @type {string | null | undefined} */ runtimeId) =>
        runtimeId === 'alt' ? altRuntime : defaultRuntime,
}));

const mod = await import('../../../src/copilot/presentation/runtime/controls.js');

describe('presentation/runtime-controls', () => {
    it('encapsula snapshots e threshold via façade compartilhada', async () => {
        expect(mod.createAgentRuntimeSnapshot(snapshotInput)).toEqual(
            expect.objectContaining({ snapshotId: 'snap-1', model: 'gpt-5' }),
        );
        await mod.saveAgentRuntimeSnapshot(snapshotRecord);
        await mod.listAgentRuntimeSnapshots();
        await mod.loadAgentRuntimeSnapshot('snap-1');
        mod.setDefaultAgentBackgroundCompactionThreshold(0.5);

        expect(saveRuntimeSnapshot).toHaveBeenCalled();
        expect(listRuntimeSnapshots).toHaveBeenCalled();
        expect(loadRuntimeSnapshot).toHaveBeenCalledWith('snap-1');
        expect(setRuntimeBackgroundCompactionThreshold).toHaveBeenCalledWith(0.5);
    });

    it('encapsula dialog controls e handoff do runtime default', async () => {
        await mod.pauseDefaultAgentDialogLoop();
        await mod.resumeDefaultAgentDialogLoop();
        await mod.stopDefaultAgentDialogLoopAuthorized();
        mod.pingDefaultAgentDialogWatchdog();

        expect(mod.readDefaultAgentHandoffHistory()).toEqual([{ id: 'h-1' }]);
        expect(getRuntimeHandoffHistory).toHaveBeenCalledWith(defaultRuntime);
        expect(pauseDialogLoop).toHaveBeenCalled();
        expect(resumeDialogLoop).toHaveBeenCalled();
        expect(stopAgentDialogLoopAuthorized).toHaveBeenCalledWith(defaultRuntime, 'authorized_stop');
        expect(pingDialogWatchdog).toHaveBeenCalled();
    });

    it('resolve runtime explícito para dialog controls e handoff', async () => {
        await mod.pauseAgentDialogLoop('alt');
        await mod.resumeAgentDialogLoop('alt');
        await mod.stopAgentRuntimeDialogLoopAuthorized('alt');

        expect(mod.getAgentRuntimeControlsTarget('alt')).toBe(altRuntime);
        expect(mod.getAgentHandoffManager('alt')).toEqual({ getHistory: expect.any(Function) });
        expect(mod.readAgentHandoffHistory('alt')).toEqual([{ id: 'h-1' }]);
        expect(altPauseDialogLoop).toHaveBeenCalled();
        expect(altResumeDialogLoop).toHaveBeenCalled();
        expect(stopAgentDialogLoopAuthorized).toHaveBeenCalledWith(altRuntime, 'authorized_stop');
    });
});
