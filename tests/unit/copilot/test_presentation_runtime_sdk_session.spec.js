vi.mock('#copilot/agent', () => ({
    deleteAgentSdkPlan: vi.fn(async (runtime) => runtime.deleteSdkPlan()),
    readAgentRuntimeStatusSnapshot: vi.fn((runtime) => runtime.getStatusSnapshot()),
    readAgentRuntimeStatusValue: vi.fn((runtime) => runtime.getStatusSnapshot().status ?? 'idle'),
    readAgentSdkPlan: vi.fn(async (runtime) => runtime.readSdkPlan()),
    readAgentSdkSessionMode: vi.fn(async (runtime) => runtime.getSdkSessionMode()),
    setAgentSdkSessionMode: vi.fn(async (runtime, mode) => runtime.setSdkSessionMode(mode)),
    updateAgentSdkPlan: vi.fn(async (runtime, content) => runtime.updateSdkPlan(content)),
}));

// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    sessionId: 'sdk-default',
    getSdkSessionMode: vi.fn(async () => ({ mode: 'interactive' })),
    getSdkSessionCapabilities: vi.fn(() => ({ ui: { elicitation: true } })),
    isSdkSessionUiElicitationAvailable: vi.fn(() => true),
    confirmSdkSessionUi: vi.fn(async () => true),
    selectSdkSessionUi: vi.fn(async (_message, options) => options[0] ?? null),
    inputSdkSessionUi: vi.fn(async (message) => `${message}:default`),
    setSdkSessionMode: vi.fn(async (/** @type {any} */ mode) => ({ mode })),
    readSdkPlan: vi.fn(async () => ({ path: '/tmp/default-plan.md', content: 'default' })),
    updateSdkPlan: vi.fn(async () => ({ ok: true })),
    deleteSdkPlan: vi.fn(async () => ({ ok: true })),
    getSdkHandles: vi.fn(() => ({ session: { id: 'sdk-default' } })),
    getStatusSnapshot: vi.fn(() => ({
        sessionId: 'sdk-default',
        model: 'gpt-5-mini',
        systemPromptBinding: { digest: 'bound-digest' },
        systemPromptFreshness: { isStale: false, reason: 'ok', recommendedAction: 'none' },
    })),
});

const altRuntime = /** @type {any} */ ({
    sessionId: 'sdk-alt',
    getSdkSessionMode: vi.fn(async () => ({ mode: 'plan' })),
    getSdkSessionCapabilities: vi.fn(() => ({ ui: { elicitation: false } })),
    isSdkSessionUiElicitationAvailable: vi.fn(() => false),
    confirmSdkSessionUi: vi.fn(async () => false),
    selectSdkSessionUi: vi.fn(async (_message, options) => options.at(-1) ?? null),
    inputSdkSessionUi: vi.fn(async (message) => `${message}:alt`),
    setSdkSessionMode: vi.fn(async (/** @type {any} */ mode) => ({ mode })),
    readSdkPlan: vi.fn(async () => ({ path: '/tmp/alt-plan.md', content: 'alt' })),
    updateSdkPlan: vi.fn(async () => ({ ok: true })),
    deleteSdkPlan: vi.fn(async () => ({ ok: true })),
    getSdkHandles: vi.fn(() => ({ session: { id: 'sdk-alt' } })),
    getStatusSnapshot: vi.fn(() => ({
        sessionId: 'sdk-alt',
        model: 'gpt-5',
        systemPromptBinding: { digest: 'alt-bound-digest' },
        systemPromptFreshness: { isStale: true, reason: 'stale', recommendedAction: 'resume-session' },
    })),
});

vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        readSystemPromptStatus: vi.fn(async () => ({
            effectiveMode: 'append',
            effectiveLiveMode: 'customize',
            liveReloadMechanism: 'sdk-transform',
            revision: { digest: 'prompt-digest' },
        })),
        readSessionInstructionSources: vi.fn(async () => ({ sources: [{ type: 'system', origin: 'sdk' }] })),
    };
});

vi.mock('../../../src/copilot/presentation/agent/runtime/index.js', () => ({
    requireAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => {
        if (runtimeId === 'missing') {
            throw Object.assign(new Error("Runtime 'missing' não encontrado."), {
                name: 'NotFoundError',
                code: 'AGENT_RUNTIME_NOT_FOUND',
                status: 404,
            });
        }
        return {
            runtime: runtimeId === 'alt' ? altRuntime : defaultRuntime,
            requestedRuntimeId: runtimeId ?? null,
            runtimeId: runtimeId ?? 'default',
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
            defaultRuntimeId: 'default',
        };
    },
}));

const runtimeSdkSession = await import('../../../src/copilot/presentation/runtime/sdk-session.js');

describe('presentation/runtime-sdk-session', () => {
    it('lê e altera mode/plan no runtime default', async () => {
        expect(await runtimeSdkSession.getAgentSdkSessionMode()).toEqual({ mode: 'interactive' });
        expect(runtimeSdkSession.getAgentSdkSessionCapabilities()).toEqual({ ui: { elicitation: true } });
        expect(runtimeSdkSession.isAgentSdkSessionUiElicitationAvailable()).toBe(true);
        expect(await runtimeSdkSession.readAgentSdkPlan()).toEqual({
            path: '/tmp/default-plan.md',
            content: 'default',
        });
        await expect(runtimeSdkSession.confirmAgentSdkSessionUi('Confirma?')).resolves.toBe(true);
        await expect(runtimeSdkSession.selectAgentSdkSessionUi('Selecione', ['dev', 'prod'])).resolves.toBe('dev');
        await expect(runtimeSdkSession.inputAgentSdkSessionUi('Nome?')).resolves.toBe('Nome?:default');

        await runtimeSdkSession.setAgentSdkSessionMode('plan');
        await runtimeSdkSession.updateAgentSdkPlan('novo plano');
        await runtimeSdkSession.deleteAgentSdkPlan();

        expect(defaultRuntime.setSdkSessionMode).toHaveBeenCalledWith('plan');
        expect(defaultRuntime.updateSdkPlan).toHaveBeenCalledWith('novo plano');
        expect(defaultRuntime.deleteSdkPlan).toHaveBeenCalled();
    });

    it('resolve runtimeId explícito para operações vanilla da sessão SDK', async () => {
        expect(await runtimeSdkSession.getAgentSdkSessionMode('alt')).toEqual({ mode: 'plan' });
        expect(runtimeSdkSession.getAgentSdkSessionCapabilities('alt')).toEqual({ ui: { elicitation: false } });
        expect(runtimeSdkSession.isAgentSdkSessionUiElicitationAvailable('alt')).toBe(false);
        expect(await runtimeSdkSession.readAgentSdkPlan('alt')).toEqual({ path: '/tmp/alt-plan.md', content: 'alt' });
        await expect(runtimeSdkSession.confirmAgentSdkSessionUi('Confirma?', 'alt')).resolves.toBe(false);
        await expect(runtimeSdkSession.selectAgentSdkSessionUi('Selecione', ['dev', 'prod'], 'alt')).resolves.toBe(
            'prod',
        );
        await expect(runtimeSdkSession.inputAgentSdkSessionUi('Nome?', undefined, 'alt')).resolves.toBe('Nome?:alt');

        await runtimeSdkSession.setAgentSdkSessionMode('autopilot', 'alt');
        await runtimeSdkSession.updateAgentSdkPlan('alt plano', 'alt');
        await runtimeSdkSession.deleteAgentSdkPlan('alt');

        expect(altRuntime.setSdkSessionMode).toHaveBeenCalledWith('autopilot');
        expect(altRuntime.updateSdkPlan).toHaveBeenCalledWith('alt plano');
        expect(altRuntime.deleteSdkPlan).toHaveBeenCalled();
    });

    it('rejeita runtimeId explícito inexistente em vez de usar fallback implícito', async () => {
        await expect(runtimeSdkSession.getAgentSdkSessionMode('missing')).rejects.toThrow(
            "Runtime 'missing' não encontrado.",
        );
        await expect(runtimeSdkSession.listAgentSdkModels('missing')).rejects.toThrow(
            "Runtime 'missing' não encontrado.",
        );
    });

    it('projeta status do system prompt e instruction sources da sessão ativa', async () => {
        const projection = await runtimeSdkSession.readAgentSdkSystemPromptProjection();

        expect(projection.sessionId).toBe('sdk-default');
        expect(projection.sessionAvailable).toBe(true);
        expect(projection.systemPrompt.effectiveMode).toBe('append');
        expect(projection.systemPrompt.revision.digest).toBe('prompt-digest');
        expect(projection.binding).toEqual({ digest: 'bound-digest' });
        expect(projection.freshness).toEqual({ isStale: false, reason: 'ok', recommendedAction: 'none' });
        expect(projection.instructionSources).toEqual({ sources: [{ type: 'system', origin: 'sdk' }] });
        expect(projection.instructionSourcesError).toBeNull();
        const unified = /** @type {Record<string, unknown>} */ (projection.projection);
        const unifiedStatus = /** @type {{ effectiveMode?: string }} */ (unified['status']);
        const unifiedSession = /** @type {{ id?: string; available?: boolean }} */ (unified['session']);
        const unifiedSources = /** @type {{ value?: unknown }} */ (unified['instructionSources']);
        const unifiedOwnership = /** @type {{ policyOwner?: string }} */ (unified['ownership']);

        expect(unifiedStatus.effectiveMode).toBe('append');
        expect(unifiedSession).toEqual({ id: 'sdk-default', available: true });
        expect(unifiedSources.value).toEqual({
            sources: [{ type: 'system', origin: 'sdk' }],
        });
        expect(unifiedOwnership.policyOwner).toBe('config/system-prompt');
    });
});
