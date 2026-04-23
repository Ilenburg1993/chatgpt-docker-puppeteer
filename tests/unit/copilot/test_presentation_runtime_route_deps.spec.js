// @ts-check

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    agent: { status: 'idle' },
    metrics: { name: 'metrics-store' },
    allTools: [{ name: 'grep' }],
    getClient: vi.fn(),
    getClientState: vi.fn(),
    stopClient: vi.fn(),
    forceStopClient: vi.fn(),
    resolve: vi.fn(() => ({ name: 'metrics-store' })),
}));

vi.mock('#copilot/core', () => ({
    container: { resolve: mocks.resolve },
}));

vi.mock('#copilot/observability', () => ({
    METRICS_STORE: Symbol.for('METRICS_STORE'),
}));

vi.mock('#copilot/sdk', () => ({
    getClient: mocks.getClient,
    getClientState: mocks.getClientState,
    stopClient: mocks.stopClient,
    forceStopClient: mocks.forceStopClient,
}));

vi.mock('#copilot/tools', () => ({
    getAllTools: () => mocks.allTools,
}));

vi.mock('../../../src/copilot/presentation/agent-runtime.js', () => ({
    resolveAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => ({
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'alt' ? 'default' : (runtimeId ?? 'default'),
        runtime: mocks.agent,
        runtimeFound: runtimeId !== 'alt',
        usedDefaultRuntimeFallback: runtimeId === 'alt',
        defaultRuntimeId: 'default',
    }),
}));

describe('presentation/runtime-route-deps.js', () => {
    it('compõe deps do copilot-api a partir do runtime default', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-route-deps.js');
        expect(mod.buildDefaultCopilotApiRouteDeps()).toEqual({
            agent: mocks.agent,
            runtimeId: 'default',
            requestedRuntimeId: null,
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
        });
    });

    it('aceita runtimeId explícito para preparar multi-agent futuro', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-route-deps.js');
        const deps = mod.buildDefaultCopilotApiRouteDeps('alt');
        expect(deps.requestedRuntimeId).toBe('alt');
        expect(deps.runtimeId).toBe('default');
        expect(deps.runtimeFound).toBe(false);
        expect(deps.usedDefaultRuntimeFallback).toBe(true);
        expect(deps.agent).toBe(mocks.agent);
    });
});

describe('server/routes/sdk/deps.js', () => {
    it('compõe deps compartilhadas do sdk router no adapter HTTP do SDK', async () => {
        const mod = await import('../../../src/copilot/server/routes/sdk/deps.js');
        const deps = mod.buildDefaultSdkRouteSharedDeps();

        expect(deps.agent).toBe(mocks.agent);
        expect(deps.runtimeId).toBe('default');
        expect(deps.runtimeFound).toBe(true);
        expect(deps.metrics).toEqual({ name: 'metrics-store' });
        expect(deps.allTools).toEqual([{ name: 'grep' }]);
        expect(deps.getClient).toBe(mocks.getClient);
        expect(deps.getClientState).toBe(mocks.getClientState);
        expect(deps.stopClient).toBe(mocks.stopClient);
        expect(deps.forceStopClient).toBe(mocks.forceStopClient);
    });
});
