// @ts-check

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const facadeMocks = vi.hoisted(() => ({
    clearAgentRuntimePendingQuestionShadow: vi.fn(() => false),
    markAgentRuntimeDialogPausedForRecovery: vi.fn(async () => ({ ok: true, value: undefined })),
    shouldScheduleAgentRuntimeDialogBootRecovery: vi.fn(async () => false),
    getAgentSdkModelStatsTracker: vi.fn(() => ({
        record() {},
        allStats() {
            return {};
        },
    })),
    isAgentSdkExperimentalEnabled: vi.fn(() => false),
}));

vi.mock('../../../src/copilot/agent/facades/index.js', () => ({
    clearAgentRuntimePendingQuestionShadow: facadeMocks.clearAgentRuntimePendingQuestionShadow,
    markAgentRuntimeDialogPausedForRecovery: facadeMocks.markAgentRuntimeDialogPausedForRecovery,
    shouldScheduleAgentRuntimeDialogBootRecovery: facadeMocks.shouldScheduleAgentRuntimeDialogBootRecovery,
    getAgentSdkModelStatsTracker: facadeMocks.getAgentSdkModelStatsTracker,
    isAgentSdkExperimentalEnabled: facadeMocks.isAgentSdkExperimentalEnabled,
}));

import {
    createBootWiringState,
    runDialogBootRecovery,
    scheduleDialogBootRecovery,
    stepScheduleDialogRecovery,
} from '../../../src/copilot/agent/session/boot/boot-steps.js';

/**
 * @param {Partial<import('../../../src/copilot/agent/session/boot/boot-steps.js').BootWiringContext>} [overrides]
 */
function createCtx(overrides = {}) {
    return /** @type {import('../../../src/copilot/agent/session/boot/boot-steps.js').BootWiringContext} */ ({
        emit: vi.fn(() => true),
        getStatusSnapshot: vi.fn(() => /** @type {any} */ ({ status: 'idle' })),
        onCheckpointPath: vi.fn(),
        onContextState: vi.fn(),
        onPrInfo: vi.fn(),
        isProcessing: vi.fn(() => false),
        dialogLoopActive: vi.fn(() => false),
        getSessionId: vi.fn(() => 'sess-1'),
        getStatus: vi.fn(() => 'idle'),
        hasPendingQuestion: vi.fn(() => false),
        hasPendingQuestionShadow: vi.fn(() => false),
        isPendingQuestionShadowExpired: vi.fn(() => false),
        clearPendingQuestionShadow: vi.fn(),
        dialogLoop: /** @type {any} */ ({}),
        keepalive: /** @type {any} */ ({}),
        receiveHandoff: vi.fn(),
        ensureDialogLoopAttached: vi.fn(),
        resumeDialogLoop: vi.fn(async () => {}),
        startDialogLoop: vi.fn(async () => {}),
        startKeepalive: vi.fn(() => false),
        getDialogPrMetrics: vi.fn(() => null),
        trackBackgroundTask: vi.fn(async (task) => {
            await task;
        }),
        ...overrides,
    });
}

describe('boot-steps dialog boot recovery', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        facadeMocks.markAgentRuntimeDialogPausedForRecovery.mockClear();
        facadeMocks.markAgentRuntimeDialogPausedForRecovery.mockResolvedValue({ ok: true, value: undefined });
        facadeMocks.shouldScheduleAgentRuntimeDialogBootRecovery.mockClear();
        facadeMocks.shouldScheduleAgentRuntimeDialogBootRecovery.mockResolvedValue(false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('runDialogBootRecovery reanexa sessão retomada sem boot prompt nem resume com PR', async () => {
        const ctx = createCtx();

        await runDialogBootRecovery(ctx);

        expect(facadeMocks.markAgentRuntimeDialogPausedForRecovery).not.toHaveBeenCalled();
        expect(ctx.ensureDialogLoopAttached).toHaveBeenCalledTimes(1);
        expect(ctx.resumeDialogLoop).not.toHaveBeenCalled();
        expect(ctx.startDialogLoop).toHaveBeenCalledWith(undefined, { resumeSessionAttach: true });
    });

    it('stepScheduleDialogRecovery consulta a decisão semântica de scheduling e agenda o timer quando aplicável', async () => {
        facadeMocks.shouldScheduleAgentRuntimeDialogBootRecovery.mockResolvedValue(true);
        const ctx = createCtx();
        const state = createBootWiringState();

        stepScheduleDialogRecovery(true, ctx, state);
        await Promise.resolve();
        await Promise.resolve();

        expect(facadeMocks.shouldScheduleAgentRuntimeDialogBootRecovery).toHaveBeenCalledTimes(1);

        await vi.runAllTimersAsync();
        await Promise.resolve();

        expect(ctx.trackBackgroundTask).toHaveBeenCalledTimes(2);
        expect(ctx.trackBackgroundTask).toHaveBeenNthCalledWith(
            1,
            expect.any(Promise),
            expect.objectContaining({ label: 'dialog.boot_recovery.schedule' }),
        );
        expect(ctx.trackBackgroundTask).toHaveBeenNthCalledWith(
            2,
            expect.any(Promise),
            expect.objectContaining({ label: 'dialog.boot_recovery.run' }),
        );
        expect(state.unsubs).toHaveLength(1);
    });

    it('scheduleDialogBootRecovery não executa o recovery quando o agente já está stopped', async () => {
        const ctx = createCtx({ getStatus: vi.fn(() => 'stopped') });

        scheduleDialogBootRecovery(ctx);
        vi.runOnlyPendingTimers();
        await Promise.resolve();

        expect(ctx.trackBackgroundTask).not.toHaveBeenCalled();
        assert.equal(facadeMocks.markAgentRuntimeDialogPausedForRecovery.mock.calls.length, 0);
    });
});
