// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    clearAgentRuntimePendingQuestionShadow: vi.fn(() => true),
    shouldReapAgentRuntimePendingQuestionShadow: vi.fn(() => true),
}));

vi.mock('../../../src/copilot/agent/facades/agent-runtime-state.js', () => ({
    clearAgentRuntimePendingQuestionShadow: mocks.clearAgentRuntimePendingQuestionShadow,
    shouldReapAgentRuntimePendingQuestionShadow: mocks.shouldReapAgentRuntimePendingQuestionShadow,
}));

vi.mock('../../../src/copilot/agent/lifecycle/state/state-io.js', () => ({
    readStateAsync: vi.fn(async () => null),
}));

import { reapExpiredPendingQuestionShadow } from '../../../src/copilot/agent/session/boot/boot-steps.js';

describe('boot-steps › pendingQuestionShadow reaper', () => {
    beforeEach(() => {
        mocks.clearAgentRuntimePendingQuestionShadow.mockClear();
        mocks.clearAgentRuntimePendingQuestionShadow.mockReturnValue(true);
        mocks.shouldReapAgentRuntimePendingQuestionShadow.mockClear();
        mocks.shouldReapAgentRuntimePendingQuestionShadow.mockReturnValue(true);
    });

    it('limpa shadow expirada em runtime quando não há pergunta viva', async () => {
        const reaped = reapExpiredPendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestion: () => false,
                hasPendingQuestionShadow: () => true,
                isPendingQuestionShadowExpired: () => true,
            }),
        );

        expect(reaped).toBe(true);
        expect(mocks.clearAgentRuntimePendingQuestionShadow).toHaveBeenCalledWith(
            expect.objectContaining({
                hasPendingQuestion: expect.any(Function),
                hasPendingQuestionShadow: expect.any(Function),
                isPendingQuestionShadowExpired: expect.any(Function),
            }),
            {
                label: 'state.pendingQuestionShadow.reap',
                description: 'Reap expired ask_user shadow during runtime metrics tick',
            },
        );
        expect(mocks.shouldReapAgentRuntimePendingQuestionShadow).toHaveBeenCalledTimes(1);
    });

    it('não limpa shadow quando ainda existe pergunta viva ou shadow válida', () => {
        mocks.shouldReapAgentRuntimePendingQuestionShadow.mockReturnValue(false);
        const withLivePending = reapExpiredPendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestion: () => true,
                hasPendingQuestionShadow: () => true,
                isPendingQuestionShadowExpired: () => true,
            }),
        );
        const withValidShadow = reapExpiredPendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestion: () => false,
                hasPendingQuestionShadow: () => true,
                isPendingQuestionShadowExpired: () => false,
            }),
        );

        expect(withLivePending).toBe(false);
        expect(withValidShadow).toBe(false);
        expect(mocks.clearAgentRuntimePendingQuestionShadow).not.toHaveBeenCalled();
        expect(mocks.shouldReapAgentRuntimePendingQuestionShadow).toHaveBeenCalledTimes(2);
    });
});
