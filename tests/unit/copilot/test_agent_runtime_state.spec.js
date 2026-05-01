// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    persistStateWithPolicy: vi.fn(async () => ({ ok: true, value: undefined })),
    readState: vi.fn(/** @returns {unknown} */ () => null),
    readStateAsync: vi.fn(/** @returns {Promise<unknown>} */ async () => null),
    createSnapshot: vi.fn((data) => ({ snapshotId: 'snap-test', createdAt: 1, ...data })),
    saveSnapshotAsync: vi.fn(async () => '/tmp/snap-test.json'),
}));

vi.mock('../../../src/copilot/agent/lifecycle/state/state-io.js', () => ({
    persistStateWithPolicy: mocks.persistStateWithPolicy,
    readState: mocks.readState,
    readStateAsync: mocks.readStateAsync,
}));

vi.mock('../../../src/copilot/agent/session/state/snapshot.js', () => ({
    createSnapshot: mocks.createSnapshot,
    saveSnapshotAsync: mocks.saveSnapshotAsync,
}));

import {
    clearAgentRuntimePendingQuestionShadow,
    markAgentRuntimeDialogPausedForRecovery,
    persistAgentRuntimeGracefulShutdownState,
    persistAgentRuntimePendingQuestionState,
    persistAgentRuntimePrConsumptionSnapshot,
    readAgentRuntimeSessionId,
    resetAgentRuntimeGracefulShutdownFlag,
    restoreAgentRuntimePersistentBootState,
    saveAgentRuntimeShutdownSnapshot,
    shouldReapAgentRuntimePendingQuestionShadow,
    shouldScheduleAgentRuntimeDialogBootRecovery,
} from '../../../src/copilot/agent/facades/agent-runtime-state.js';

describe('agent-runtime-state facade', () => {
    beforeEach(() => {
        mocks.persistStateWithPolicy.mockClear();
        mocks.persistStateWithPolicy.mockResolvedValue({ ok: true, value: undefined });
        mocks.readState.mockReset();
        mocks.readState.mockReturnValue(null);
        mocks.readStateAsync.mockReset();
        mocks.readStateAsync.mockResolvedValue(null);
        mocks.createSnapshot.mockClear();
        mocks.saveSnapshotAsync.mockClear();
    });

    it('prefere o sessionId da sessão viva e só usa o persistido como fallback', () => {
        const fromActive = readAgentRuntimeSessionId(
            /** @type {any} */ ({
                getSessionSnapshot: () => ({ sessionId: 'sdk-live-1' }),
                hasPendingQuestionShadow: () => false,
                clearPendingQuestionShadow: () => {},
            }),
        );

        mocks.readState.mockReturnValue({ sessionId: 'sdk-persisted-1' });
        const fromPersisted = readAgentRuntimeSessionId(
            /** @type {any} */ ({
                getSessionSnapshot: () => null,
                hasPendingQuestionShadow: () => false,
                clearPendingQuestionShadow: () => {},
            }),
        );

        expect(fromActive).toBe('sdk-live-1');
        expect(fromPersisted).toBe('sdk-persisted-1');
    });

    it('limpa a shadow e agenda persistência canônica via trackBackgroundTask', async () => {
        const clearPendingQuestionShadow = vi.fn();
        const trackBackgroundTask = vi.fn(async (task) => {
            await task;
        });

        const cleared = clearAgentRuntimePendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestionShadow: () => true,
                clearPendingQuestionShadow,
                trackBackgroundTask,
            }),
            {
                label: 'state.pendingQuestionShadow.clear',
                description: 'Clear ask_user shadow from persisted state',
            },
        );

        expect(cleared).toBe(true);
        expect(clearPendingQuestionShadow).toHaveBeenCalled();
        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'state.pendingQuestionShadow.clear' },
        );
        expect(trackBackgroundTask).toHaveBeenCalled();
    });

    it('retorna false quando não há shadow para limpar', () => {
        const cleared = clearAgentRuntimePendingQuestionShadow(
            /** @type {any} */ ({
                hasPendingQuestionShadow: () => false,
                clearPendingQuestionShadow: vi.fn(),
            }),
        );

        expect(cleared).toBe(false);
        expect(mocks.persistStateWithPolicy).not.toHaveBeenCalled();
    });

    it('decide reap da shadow apenas quando não há pergunta viva, há shadow e ela expirou', () => {
        expect(
            shouldReapAgentRuntimePendingQuestionShadow(
                /** @type {any} */ ({
                    hasPendingQuestion: () => false,
                    hasPendingQuestionShadow: () => true,
                    isPendingQuestionShadowExpired: () => true,
                    clearPendingQuestionShadow: vi.fn(),
                }),
            ),
        ).toBe(true);

        expect(
            shouldReapAgentRuntimePendingQuestionShadow(
                /** @type {any} */ ({
                    hasPendingQuestion: () => true,
                    hasPendingQuestionShadow: () => true,
                    isPendingQuestionShadowExpired: () => true,
                    clearPendingQuestionShadow: vi.fn(),
                }),
            ),
        ).toBe(false);
    });

    it('decide agendar boot recovery apenas quando o estado persistido indica dialog loop ativo e não pausado', async () => {
        mocks.readStateAsync.mockResolvedValueOnce({ dialogLoopActive: true, dialogPaused: false });
        await expect(shouldScheduleAgentRuntimeDialogBootRecovery()).resolves.toBe(true);

        mocks.readStateAsync.mockResolvedValueOnce({ dialogLoopActive: true, dialogPaused: true });
        await expect(shouldScheduleAgentRuntimeDialogBootRecovery()).resolves.toBe(false);

        mocks.readStateAsync.mockResolvedValueOnce(null);
        await expect(shouldScheduleAgentRuntimeDialogBootRecovery()).resolves.toBe(false);
    });

    it('persiste dialogPaused=true via helper semântico de boot recovery', async () => {
        await markAgentRuntimeDialogPausedForRecovery();

        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            { dialogPaused: true },
            { label: 'dialog.boot_recovery.pause' },
        );
    });

    it('reseta gracefulShutdown via helper semântico de startup', async () => {
        await resetAgentRuntimeGracefulShutdownFlag();

        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            { gracefulShutdown: false },
            { label: 'state.gracefulShutdown.reset' },
        );
    });

    it('persiste snapshot de PR consumido via helper semântico', async () => {
        await persistAgentRuntimePrConsumptionSnapshot({
            model: 'gpt-5',
            cost: 0.5,
            quotaSnapshots: { main: { remainingPercentage: 80 } },
            ts: 123,
        });

        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            {
                pendingTurnConsumedPR: true,
                lastPrConsumedAt: 123,
                lastPrModel: 'gpt-5',
                lastPrConfiguredModel: '',
                lastPrModelMismatch: false,
                lastPrCost: 0.5,
                lastQuotaSnapshots: { main: { remainingPercentage: 80 } },
            },
            { label: 'state.pr_consumed.persist' },
        );
    });

    it('persiste pendingQuestion via helper semântico do runtime-state', async () => {
        await persistAgentRuntimePendingQuestionState({
            question: 'READY?',
            askedAt: 456,
            meta: {
                kind: 'ready',
                askedAt: 456,
                allowFreeform: true,
                protocolControlled: true,
            },
        });

        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            {
                pendingQuestion: 'READY?',
                pendingQuestionMeta: expect.objectContaining({ kind: 'ready', protocolControlled: true }),
                lastAskUserAt: 456,
            },
            { label: 'question.persist.pending' },
        );
    });

    it('restaura sendCount e limpa shadow ausente durante boot persistido', async () => {
        const ctx = {
            setSendCount: vi.fn(),
            setLastPrInfo: vi.fn(),
            clearPendingQuestionShadow: vi.fn(),
            hasPendingQuestionShadow: () => false,
        };

        mocks.readStateAsync.mockResolvedValueOnce({
            sendCount: 42,
            sessionId: 'sdk-live',
            lastPrConsumedAt: 1000,
            lastPrModel: 'claude-haiku-4.5',
            lastPrConfiguredModel: 'gpt-5.4',
            lastPrModelMismatch: true,
            lastPrCost: 0.33,
            lastQuotaSnapshots: { premium_interactions: { remainingPercentage: 99.1 } },
        });
        const result = await restoreAgentRuntimePersistentBootState(/** @type {any} */ (ctx));

        expect(result).toEqual({
            sendCount: 42,
            pendingQuestionShadowRestored: false,
            pendingQuestionShadowExpired: false,
        });
        expect(ctx.setSendCount).toHaveBeenCalledWith(42);
        expect(ctx.setLastPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                ts: 1000,
                model: 'claude-haiku-4.5',
                configuredModel: 'gpt-5.4',
                modelMismatch: true,
                sessionId: 'sdk-live',
                cost: 0.33,
                quotaSnapshots: { premium_interactions: { remainingPercentage: 99.1 } },
            }),
        );
        expect(ctx.clearPendingQuestionShadow).toHaveBeenCalledTimes(1);
    });

    it('restaura shadow persistida expirada e agenda limpeza canônica', async () => {
        const setPendingQuestionShadow = vi.fn();
        const trackBackgroundTask = vi.fn(async (task) => {
            await task;
        });
        const ctx = {
            setSendCount: vi.fn(),
            setPendingQuestionShadow,
            clearPendingQuestionShadow: vi.fn(),
            hasPendingQuestionShadow: () => false,
            trackBackgroundTask,
        };

        mocks.readStateAsync.mockResolvedValueOnce({
            sendCount: 3,
            pendingQuestion: 'READY?',
            pendingQuestionMeta: {
                kind: 'ready',
                askedAt: 1,
                allowFreeform: true,
                protocolControlled: true,
            },
        });

        const result = await restoreAgentRuntimePersistentBootState(/** @type {any} */ (ctx));

        expect(result.pendingQuestionShadowRestored).toBe(true);
        expect(result.pendingQuestionShadowExpired).toBe(true);
        expect(setPendingQuestionShadow).toHaveBeenCalledWith(
            expect.objectContaining({
                question: 'READY?',
                meta: expect.objectContaining({ kind: 'ready' }),
            }),
        );
        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'state.pendingQuestionShadow.expire' },
        );
        expect(trackBackgroundTask).toHaveBeenCalledWith(
            expect.any(Promise),
            expect.objectContaining({ label: 'state.pendingQuestionShadow.expire' }),
        );
    });

    it('salva snapshot de shutdown a partir do runtime state canônico', async () => {
        const ctx = {
            getPendingQuestionSnapshot: () => ({
                question: 'Continuar?',
                kind: 'question',
                askedAt: 10,
                allowFreeform: false,
                protocolControlled: true,
                choices: ['sim', 'não'],
            }),
            getModelSnapshot: () => 'gpt-5',
            getRuntimeStatus: () => 'idle',
            getSendCountSnapshot: () => 9,
            isDialogLoopPaused: () => false,
            hasPendingQuestionShadow: () => false,
            clearPendingQuestionShadow: vi.fn(),
        };

        await expect(
            saveAgentRuntimeShutdownSnapshot(/** @type {any} */ (ctx), {
                sessionId: 'sdk-1',
                dialogLoopActive: true,
                dialogPrMetrics: { boots: 1, resumesWithPR: 2, resumesZeroPR: 0, totalPR: 3 },
            }),
        ).resolves.toBe('/tmp/snap-test.json');

        expect(mocks.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'sdk-1',
                model: 'gpt-5',
                status: 'idle',
                sendCount: 9,
                dialogLoopActive: true,
                pendingQuestion: 'Continuar?',
                pendingQuestionMeta: expect.objectContaining({ choices: ['sim', 'não'] }),
            }),
        );
        expect(mocks.saveSnapshotAsync).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-test' }));
    });

    it('persiste gracefulShutdown=true com estado mínimo de retomada', async () => {
        const ctx = {
            getSendCountSnapshot: () => 11,
            isDialogLoopPaused: () => true,
            hasPendingQuestionShadow: () => false,
            clearPendingQuestionShadow: vi.fn(),
        };

        await persistAgentRuntimeGracefulShutdownState(/** @type {any} */ (ctx), { dialogLoopActive: false });

        expect(mocks.persistStateWithPolicy).toHaveBeenCalledWith(
            {
                sendCount: 11,
                gracefulShutdown: true,
                dialogLoopActive: false,
                dialogPaused: true,
            },
            { label: 'state.gracefulShutdown.persist' },
        );
    });
});
