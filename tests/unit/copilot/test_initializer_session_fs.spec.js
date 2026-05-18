import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    buildAuditingPermissionHandler: vi.fn((handler) => handler ?? (async () => ({ kind: 'approve-once' }))),
    buildSystemPromptBindingSnapshot: vi.fn((status, sessionId) => ({ digest: status.revision.digest, sessionId })),
    buildCustomAgentsConfig: vi.fn(() => []),
    buildLiveSystemMessage: vi.fn(async () => ({ mode: 'customize', sections: {} })),
    readSystemPromptStatus: vi.fn(async () => ({ revision: { digest: 'prompt-digest' } })),
    canReadAgentSdkSessionMessages: vi.fn(() => true),
    createAgentSdkSessionByClient: vi.fn(
        /** @returns {Promise<any>} */ async (_client, options) => ({
            session: { sessionId: 'new-sess' },
            isResumed: false,
            options,
        }),
    ),
    formatValidationResult: vi.fn(() => 'Agent contracts OK'),
    getAgentConfiguredSessionFsHandler: vi.fn(() => vi.fn()),
    loadAgentSdkToolsConfigAsync: vi.fn(async () => undefined),
    pickDefinedAgentSdkOptions: vi.fn((value) => value),
    readAgentSdkSessionMessages: vi.fn(async () => []),
    resumeOrCreateAgentSdkSession: vi.fn(
        /** @returns {Promise<any>} */ async (_client, _savedSessionId, options) => ({
            session: { sessionId: 'new-sess' },
            isResumed: false,
            options,
        }),
    ),
    validateAgentContracts: vi.fn(() => ({ errors: [], warnings: [], contractLog: {} })),
    persistState: vi.fn(async () => ({ ok: true })),
    readState: vi.fn(/** @returns {Promise<unknown>} */ async () => null),
    buildHookSystemContextSafe: vi.fn(async () => 'hook ctx'),
}));

vi.mock('#copilot/audit', () => ({ buildAuditingPermissionHandler: mocks.buildAuditingPermissionHandler }));
vi.mock('#copilot/boot', () => ({
    COPILOT_PACKAGE_ROOT: '/workspace',
    WORKSPACE_ROOT: '/workspace',
    readBootSkillConfig: vi.fn(() => ({ skillDirectories: ['/skills'] })),
    resolvePersistentConfigFile: vi.fn((name) => `/tmp/copilot-test/${name}`),
}));
vi.mock('#copilot/config', () => ({
    COPILOT_EVENTS_MAX_BYTES: 1024 * 1024,
    COPILOT_LOG_DIR: '',
    MAESTRO_AGENT_NAME: 'agent-full',
    buildCustomAgentsConfig: mocks.buildCustomAgentsConfig,
}));
vi.mock('#copilot/core', () => ({
    SHUTDOWN_PRIORITY: { BACKGROUND: 50 },
    buildCanonicalLocalSurfaceExcludedTools: (
        /** @type {string[]} */ toolNames,
        /** @type {string[]} */ baseExcluded = [],
    ) => {
        const excluded = new Set(baseExcluded);
        const hasCanonicalFs = [
            'list_directory',
            'read_file_content',
            'search_in_files',
            'create_file',
            'write_file_content',
            'patch_file',
        ].every((name) => toolNames.includes(name));
        if (hasCanonicalFs) {
            for (const name of ['view', 'glob', 'grep', 'create', 'edit']) excluded.add(name);
        }
        return [...excluded].sort();
    },
    logSwallowed: vi.fn(),
    registerShutdownHandler: vi.fn(),
    toError: (/** @type {unknown} */ error) => (error instanceof Error ? error : new Error(String(error))),
}));
vi.mock('../../../src/copilot/config/agent.js', () => ({
    ROTATION_MAX_AGE_MS: 86_400_000,
    ROTATION_MAX_COMPACTIONS: 3,
    ROTATION_MAX_TURNS: 200,
    ROTATION_MAX_UTIL: 0.95,
    SESSION_MAX_AGE_MS: 86_400_000,
}));
vi.mock('../../../src/copilot/config/system-prompt/index.js', () => ({
    buildLiveSystemMessage: mocks.buildLiveSystemMessage,
    buildSystemPromptBindingSnapshot: mocks.buildSystemPromptBindingSnapshot,
    readSystemPromptStatus: mocks.readSystemPromptStatus,
}));
vi.mock('../../../src/copilot/agent/facades/agent-sdk-access.js', () => ({
    AGENT_SDK_DEFAULT_MODEL: 'auto',
    canReadAgentSdkSessionMessages: mocks.canReadAgentSdkSessionMessages,
    createAgentSdkSessionByClient: mocks.createAgentSdkSessionByClient,
    formatValidationResult: mocks.formatValidationResult,
    getAgentConfiguredSessionFsHandler: mocks.getAgentConfiguredSessionFsHandler,
    loadAgentSdkToolsConfigAsync: mocks.loadAgentSdkToolsConfigAsync,
    pickDefinedAgentSdkOptions: mocks.pickDefinedAgentSdkOptions,
    readAgentSdkSessionMessages: mocks.readAgentSdkSessionMessages,
    resumeOrCreateAgentSdkSession: mocks.resumeOrCreateAgentSdkSession,
    validateAgentContracts: mocks.validateAgentContracts,
}));
vi.mock('../../../src/copilot/agent/facades/index.js', () => ({
    AGENT_SDK_DEFAULT_MODEL: 'auto',
    canReadAgentSdkSessionMessages: mocks.canReadAgentSdkSessionMessages,
    createAgentSdkSessionByClient: mocks.createAgentSdkSessionByClient,
    formatValidationResult: mocks.formatValidationResult,
    getAgentConfiguredSessionFsHandler: mocks.getAgentConfiguredSessionFsHandler,
    loadAgentSdkToolsConfigAsync: mocks.loadAgentSdkToolsConfigAsync,
    persistAgentRuntimeStatePartial: mocks.persistState,
    pickDefinedAgentSdkOptions: mocks.pickDefinedAgentSdkOptions,
    readAgentRuntimePersistedStateAsync: mocks.readState,
    readAgentSdkSessionMessages: mocks.readAgentSdkSessionMessages,
    resumeOrCreateAgentSdkSession: mocks.resumeOrCreateAgentSdkSession,
    validateAgentContracts: mocks.validateAgentContracts,
}));
vi.mock('../../../src/copilot/agent/facades/agent-runtime-state.js', () => ({
    persistAgentRuntimeStatePartial: mocks.persistState,
    readAgentRuntimePersistedStateAsync: mocks.readState,
}));
vi.mock('../../../src/copilot/agent/ports/logging-port.js', () => ({ log: vi.fn() }));
vi.mock('../../../src/copilot/agent/ports/metrics-port.js', () => ({
    defaultMetrics: { recordSessionRotation: vi.fn() },
}));
vi.mock('../../../src/copilot/agent/ports/index.js', () => ({
    defaultMetrics: { recordSessionRotation: vi.fn() },
    log: vi.fn(),
    startSpanImmediate: vi.fn(() => ({ end: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock('../../../src/copilot/agent/ports/tracing-port.js', () => ({
    startSpanImmediate: vi.fn(() => ({ end: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock('../../../src/copilot/agent/session/context/hook-context.js', () => ({
    buildHookSystemContextSafe: mocks.buildHookSystemContextSafe,
}));
vi.mock('../../../src/copilot/agent/session/context/index.js', () => ({
    SessionJsonSchema: {},
    buildHookSystemContext: vi.fn(async () => 'hook ctx'),
    buildHookSystemContextSafe: mocks.buildHookSystemContextSafe,
}));

describe('agent/session/initializer — sessionFs wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('injeta createSessionFsHandler configurado no fluxo initOrResumeSession', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
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

    it('injeta maestro com streaming de subagentes desabilitado por default sem poluir defaultAgent com tools locais', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const toolA = { name: 'read_file_content' };
        const toolB = { name: 'exec_command' };

        await initOrResumeSession(/** @type {any} */ ({}), { tools: /** @type {any} */ ([toolA, toolB]) });

        const sessionOptions = mocks.resumeOrCreateAgentSdkSession.mock.calls.at(-1)?.[2];
        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.objectContaining({
                agent: 'agent-full',
                includeSubAgentStreamingEvents: false,
            }),
        );
        expect(sessionOptions ? Reflect.get(sessionOptions, 'defaultAgent') : undefined).toBeUndefined();
    });

    it('oculta built-ins legadas de FS quando as file-tools canônicas locais estão presentes', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const tools = [
            { name: 'list_directory' },
            { name: 'read_file_content' },
            { name: 'search_in_files' },
            { name: 'create_file' },
            { name: 'write_file_content' },
            { name: 'patch_file' },
            { name: 'exec_command' },
        ];

        await initOrResumeSession(/** @type {any} */ ({}), {
            tools: /** @type {any} */ (tools),
            excludedTools: ['web_fetch'],
        });

        const sessionOptions = mocks.resumeOrCreateAgentSdkSession.mock.calls.at(-1)?.[2];
        expect(sessionOptions?.excludedTools).toEqual(['create', 'edit', 'glob', 'grep', 'view', 'web_fetch']);
    });

    it('preserva model=auto como configuração nativa mesmo quando o SDK observa modelo efetivo', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
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
                model: 'auto',
                reasoningEffort: 'high',
                systemPromptBinding: expect.objectContaining({ digest: 'prompt-digest', sessionId: 'resolved-sess' }),
            }),
            expect.objectContaining({ label: 'session.initializer.create' }),
        );
        expect(result).toEqual(
            expect.objectContaining({
                model: 'auto',
                reasoningEffort: 'high',
            }),
        );
    });

    it('preserva model auto nativo ao retomar sessão com modelo concreto persistido', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
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
                systemPromptBinding: expect.objectContaining({ digest: 'prompt-digest', sessionId: 'saved-sess' }),
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

    it('prioriza reasoning explícito de boot sobre reasoning persistido antigo ao retomar', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'auto',
            reasoningEffort: 'high',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
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
            reasoningEffort: 'xhigh',
        });

        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'auto',
                reasoningEffort: 'xhigh',
            }),
            expect.objectContaining({ label: 'session.initializer.resume' }),
        );
        expect(result).toEqual(expect.objectContaining({ model: 'auto', reasoningEffort: 'xhigh' }));
    });
});
