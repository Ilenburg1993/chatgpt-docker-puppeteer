// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    persistStateWithPolicy: vi.fn(async () => ({ ok: true, value: undefined })),
}));

vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    persistStateWithPolicy: mocks.persistStateWithPolicy,
    readStateAsync: vi.fn(async () => null),
}));

import { reapExpiredPendingQuestionShadow } from '../../../src/copilot/agent/session/boot-steps.js';

describe('boot-steps › pendingQuestionShadow reaper', () => {
    beforeEach(() => {
        mocks.persistStateWithPolicy.mockClear();
    });

    it('limpa shadow expirada em runtime quando não há pergunta viva', async () => {
        const clearPendingQuestionShadow = vi.fn();
        const track = vi.fn(async (task) => {
            await task;
        });

        const reaped = reapExpiredPendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestion: () => false,
                hasPendingQuestionShadow: () => true,
                isPendingQuestionShadowExpired: () => true,
                clearPendingQuestionShadow,
                backgroundTasks: { track },
            }),
        );

        expect(reaped).toBe(true);
        expect(clearPendingQuestionShadow).toHaveBeenCalled();
        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'state.pendingQuestionShadow.reap' },
        );
        expect(track).toHaveBeenCalled();
    });

    it('não limpa shadow quando ainda existe pergunta viva ou shadow válida', () => {
        const clearPendingQuestionShadow = vi.fn();
        const track = vi.fn();

        const withLivePending = reapExpiredPendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestion: () => true,
                hasPendingQuestionShadow: () => true,
                isPendingQuestionShadowExpired: () => true,
                clearPendingQuestionShadow,
                backgroundTasks: { track },
            }),
        );
        const withValidShadow = reapExpiredPendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestion: () => false,
                hasPendingQuestionShadow: () => true,
                isPendingQuestionShadowExpired: () => false,
                clearPendingQuestionShadow,
                backgroundTasks: { track },
            }),
        );

        expect(withLivePending).toBe(false);
        expect(withValidShadow).toBe(false);
        expect(clearPendingQuestionShadow).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
    });
});
