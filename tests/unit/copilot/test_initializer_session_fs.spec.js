import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildAuditingPermissionHandler: vi.fn((handler) => handler ?? (async () => ({ kind: 'approved' }))),
    buildCustomAgentsConfig: vi.fn(() => []),
    buildSystemMessage: vi.fn(() => ({ mode: 'append', content: 'ctx' })),
    canReadAgentSdkSessionMessages: vi.fn(() => true),
    createAgentSdkSessionByClient: vi.fn(async (_client, options) => ({
        session: { sessionId: 'new-sess' },
        isResumed: false,
        options,
    })),
    getAgentConfiguredSessionFsHandler: vi.fn(() => vi.fn()),
    loadAgentSdkToolsConfigAsync: vi.fn(async () => undefined),
    pickDefinedAgentSdkOptions: vi.fn((value) => value),
    readAgentSdkSessionMessages: vi.fn(async () => []),
    resumeOrCreateAgentSdkSession: vi.fn(async (_client, _savedSessionId, options) => ({
        session: { sessionId: 'new-sess' },
        isResumed: false,
        options,
    })),
    persistState: vi.fn(async () => ({ ok: true })),
    readState: vi.fn(async () => null),
    buildHookSystemContextSafe: vi.fn(async () => 'hook ctx'),
}));

vi.mock('#copilot/audit', () => ({ buildAuditingPermissionHandler: mocks.buildAuditingPermissionHandler }));
vi.mock('#copilot/boot', () => ({
    WORKSPACE_ROOT: '/workspace',
    readBootSkillConfig: vi.fn(() => ({ skillDirectories: ['/skills'] })),
}));
vi.mock('#copilot/config', () => ({ buildCustomAgentsConfig: mocks.buildCustomAgentsConfig }));
vi.mock('#copilot/core', () => ({
    toError: (/** @type {unknown} */ error) => (error instanceof Error ? error : new Error(String(error))),
}));
vi.mock('../../../src/copilot/config/agent.js', () => ({
    ROTATION_MAX_AGE_MS: 86_400_000,
    ROTATION_MAX_COMPACTIONS: 3,
    ROTATION_MAX_TURNS: 200,
    ROTATION_MAX_UTIL: 0.95,
    SESSION_MAX_AGE_MS: 86_400_000,
}));
vi.mock('../../../src/copilot/config/system-prompt/index.js', () => ({ buildSystemMessage: mocks.buildSystemMessage }));
vi.mock('../../../src/copilot/agent/facades/agent-sdk-access.js', () => ({
    AGENT_SDK_DEFAULT_MODEL: 'gpt-5-mini',
    canReadAgentSdkSessionMessages: mocks.canReadAgentSdkSessionMessages,
    createAgentSdkSessionByClient: mocks.createAgentSdkSessionByClient,
    getAgentConfiguredSessionFsHandler: mocks.getAgentConfiguredSessionFsHandler,
    loadAgentSdkToolsConfigAsync: mocks.loadAgentSdkToolsConfigAsync,
    pickDefinedAgentSdkOptions: mocks.pickDefinedAgentSdkOptions,
    readAgentSdkSessionMessages: mocks.readAgentSdkSessionMessages,
    resumeOrCreateAgentSdkSession: mocks.resumeOrCreateAgentSdkSession,
}));
vi.mock('../../../src/copilot/agent/lifecycle/state-io.js', () => ({
    persistStateWithPolicy: mocks.persistState,
    readStateAsync: mocks.readState,
}));
vi.mock('../../../src/copilot/agent/ports/observability-port.js', () => ({
    defaultMetrics: { recordSessionRotation: vi.fn() },
    log: vi.fn(),
    startSpanImmediate: vi.fn(() => ({ end: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock('../../../src/copilot/agent/session/hook-context.js', () => ({
    buildHookSystemContextSafe: mocks.buildHookSystemContextSafe,
}));

describe('agent/session/initializer — sessionFs wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('injeta createSessionFsHandler configurado no fluxo initOrResumeSession', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializer.js');
        const customHandler = vi.fn();
        mocks.getAgentConfiguredSessionFsHandler.mockReturnValue(customHandler);

        await initOrResumeSession(/** @type {any} */ ({}), { model: 'gpt-5' });

        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.objectContaining({
                createSessionFsHandler: customHandler,
                workingDirectory: '/workspace',
            }),
        );
    });

    it('persiste o modelo efetivo resolvido em vez do placeholder auto', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializer.js');
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: { sessionId: 'resolved-sess' },
            isResumed: false,
            model: 'gpt-5-mini',
            reasoningEffort: 'high',
        });

        const result = await initOrResumeSession(/** @type {any} */ ({}), {
            model: 'auto',
            reasoningEffort: 'high',
        });

        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-5-mini',
                reasoningEffort: 'high',
            }),
            expect.objectContaining({ label: 'session.initializer.create' }),
        );
        expect(result).toEqual(
            expect.objectContaining({
                model: 'gpt-5-mini',
                reasoningEffort: 'high',
            }),
        );
    });

    it('preserva model auto nativo ao retomar sessão com modelo concreto persistido', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializer.js');
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'gpt-5-mini',
            reasoningEffort: 'high',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 2,
        });
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: {
                sessionId: 'saved-sess',
                getMessages: vi.fn(async () => []),
            },
            isResumed: true,
        });

        const result = await initOrResumeSession(/** @type {any} */ ({}), {
            model: 'auto',
            reasoningEffort: 'high',
        });

        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'auto',
                reasoningEffort: 'high',
            }),
            expect.objectContaining({ label: 'session.initializer.resume' }),
        );
        expect(result).toEqual(
            expect.objectContaining({
                model: 'auto',
                reasoningEffort: 'high',
            }),
        );
    });
});
