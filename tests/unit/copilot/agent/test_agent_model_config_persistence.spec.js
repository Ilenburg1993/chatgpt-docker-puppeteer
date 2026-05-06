// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistAgentRuntimeStatePartial = vi.fn(async (data) => ({ ok: true, value: data }));
const trySetLiveSessionModel = vi.fn(() => true);
const readAgentRuntimeStatusSnapshot = vi.fn(() => ({ model: 'auto', reasoningEffort: 'high' }));

vi.mock('../../../../src/copilot/agent/facades/agent-runtime-state.js', () => ({
    persistAgentRuntimeStatePartial,
}));

vi.mock('../../../../src/copilot/agent/runtime-contracts.js', () => ({
    trySetLiveSessionModel,
}));

vi.mock('../../../../src/copilot/agent/runtime/status-readers.js', () => ({
    readAgentRuntimeStatusSnapshot,
}));

vi.mock('#copilot/sdk', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        listModels: vi.fn(async () => []),
        modelRegistry: new Map(),
        modelStatsTracker: {
            allStats: vi.fn(() => []),
        },
    };
});

describe('agent/facades/agent-model-config', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('persiste modelo alterado em background', async () => {
        const { setModel } = await import('../../../../src/copilot/agent/facades/agent-model-config.js');
        /** @type {{ task: Promise<unknown>; meta: Record<string, unknown> }[]} */
        const tracked = [];
        const ctx = {
            setModel: vi.fn(),
            getSessionSnapshot: vi.fn(() => ({ sessionId: 'sdk-1' })),
            getReasoningEffortSnapshot: vi.fn(() => 'high'),
            getLastPrInfoSnapshot: vi.fn(() => null),
            setLastPrInfo: vi.fn(),
            trackBackgroundTask: vi.fn((task, meta) => {
                tracked.push({ task, meta });
                return Promise.resolve();
            }),
        };

        setModel(/** @type {any} */ (ctx), 'gpt-5.4');

        expect(ctx.setModel).toHaveBeenCalledWith('gpt-5.4');
        expect(trySetLiveSessionModel).toHaveBeenCalledWith({ sessionId: 'sdk-1' }, 'gpt-5.4', 'AlwaysAlive', {
            reasoningEffort: 'high',
        });
        expect(ctx.setLastPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                configuredModel: 'gpt-5.4',
                sessionId: 'sdk-1',
                modelMismatch: false,
                ts: expect.any(Number),
            }),
        );
        expect(persistAgentRuntimeStatePartial).toHaveBeenCalledWith(
            { model: 'gpt-5.4' },
            { label: 'runtime.config.model' },
        );
        expect(ctx.trackBackgroundTask).toHaveBeenCalledWith(
            expect.any(Promise),
            expect.objectContaining({ label: 'runtime.config.model' }),
        );
        await Promise.all(tracked.map((entry) => entry.task));
    });

    it('persiste reasoning effort alterado em background', async () => {
        const { setReasoningEffort } = await import('../../../../src/copilot/agent/facades/agent-model-config.js');
        /** @type {{ task: Promise<unknown>; meta: Record<string, unknown> }[]} */
        const tracked = [];
        const ctx = {
            setReasoningEffort: vi.fn(),
            trackBackgroundTask: vi.fn((task, meta) => {
                tracked.push({ task, meta });
                return Promise.resolve();
            }),
        };

        setReasoningEffort(/** @type {any} */ (ctx), 'high');

        expect(ctx.setReasoningEffort).toHaveBeenCalledWith('high');
        expect(persistAgentRuntimeStatePartial).toHaveBeenCalledWith(
            { reasoningEffort: 'high' },
            { label: 'runtime.config.reasoning' },
        );
        expect(ctx.trackBackgroundTask).toHaveBeenCalledWith(
            expect.any(Promise),
            expect.objectContaining({ label: 'runtime.config.reasoning' }),
        );
        await Promise.all(tracked.map((entry) => entry.task));
    });

    it('marca mismatch quando o último modelo observado difere do configurado', async () => {
        const { setModel } = await import('../../../../src/copilot/agent/facades/agent-model-config.js');
        const ctx = {
            setModel: vi.fn(),
            getSessionSnapshot: vi.fn(() => ({ sessionId: 'sdk-2' })),
            getReasoningEffortSnapshot: vi.fn(() => 'high'),
            getLastPrInfoSnapshot: vi.fn(() => ({ model: 'claude-haiku-4.5', ts: 10 })),
            setLastPrInfo: vi.fn(),
            trackBackgroundTask: vi.fn(() => Promise.resolve()),
        };

        setModel(/** @type {any} */ (ctx), 'gpt-5.4');

        expect(ctx.setLastPrInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                configuredModel: 'gpt-5.4',
                model: 'claude-haiku-4.5',
                modelMismatch: true,
                sessionId: 'sdk-2',
            }),
        );
    });

    it('preserva model auto nativo sem enviar reasoningEffort para setModel live', async () => {
        const { setModel } = await import('../../../../src/copilot/agent/facades/agent-model-config.js');
        const ctx = {
            setModel: vi.fn(),
            getSessionSnapshot: vi.fn(() => ({ sessionId: 'sdk-auto' })),
            getReasoningEffortSnapshot: vi.fn(() => 'high'),
            getLastPrInfoSnapshot: vi.fn(() => null),
            setLastPrInfo: vi.fn(),
            trackBackgroundTask: vi.fn(() => Promise.resolve()),
        };

        setModel(/** @type {any} */ (ctx), 'auto');

        expect(ctx.setModel).toHaveBeenCalledWith('auto');
        expect(trySetLiveSessionModel).toHaveBeenCalledWith({ sessionId: 'sdk-auto' }, 'auto', 'AlwaysAlive', undefined);
    });

    it('expõe policy Auto com preferência local e último modelo observado', async () => {
        const { readRuntimeAutoModelPolicy } = await import(
            '../../../../src/copilot/agent/facades/agent-model-config.js'
        );
        const policy = readRuntimeAutoModelPolicy(
            /** @type {any} */ ({
                getStatusSnapshot: () => ({ model: 'auto', reasoningEffort: 'high' }),
                getLastPrInfoSnapshot: () => ({ effectiveModel: 'claude-haiku-4.5' }),
            }),
        );

        expect(policy).toMatchObject({
            configuredModel: 'auto',
            observedModel: 'claude-haiku-4.5',
            preferredModel: 'gpt-5.4',
            preferredReasoningEffort: 'high',
            canForcePreference: false,
        });
    });
});
