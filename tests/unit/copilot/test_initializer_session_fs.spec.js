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
vi.mock('#copilot/boot', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    COPILOT_PACKAGE_ROOT: '/workspace',
    WORKSPACE_ROOT: '/workspace',
    readCopilotBootConfig: vi.fn(() => ({
        sessionDefaults: {
            workingDirectory: '/workspace',
            skillDirectories: ['/skills'],
            disabledSkills: [],
            enableConfigDiscovery: true,
            includeSubAgentStreamingEvents: false,
            streaming: true,
        },
    })),
    readBootSkillConfig: vi.fn(() => ({ skillDirectories: ['/skills'] })),
    resolvePersistentConfigFile: vi.fn((name) => `/tmp/copilot-test/${name}`),
}));
vi.mock('#copilot/config', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
    COPILOT_EVENTS_MAX_BYTES: 1024 * 1024,
    COPILOT_LOG_DIR: '',
    MAESTRO_AGENT_NAME: 'agent-full',
    buildCustomAgentsConfig: mocks.buildCustomAgentsConfig,
}));
vi.mock('#copilot/core', async (importOriginal) => ({
    .../** @type {any} */ (await importOriginal()),
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
            for (const name of ['view', 'glob']) excluded.add(name);
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
vi.mock('../../../src/copilot/agent/facades/agent-sdk-runtime.js', () => ({
    canReadAgentSdkSessionMessages: mocks.canReadAgentSdkSessionMessages,
    readAgentSdkSessionMessages: mocks.readAgentSdkSessionMessages,
}));
vi.mock('../../../src/copilot/agent/facades/sdk-access.js', () => ({
    AGENT_SDK_DEFAULT_MODEL: 'auto',
    createAgentSdkSessionByClient: mocks.createAgentSdkSessionByClient,
    formatValidationResult: mocks.formatValidationResult,
    getAgentConfiguredSessionFsHandler: mocks.getAgentConfiguredSessionFsHandler,
    loadAgentSdkToolsConfigAsync: mocks.loadAgentSdkToolsConfigAsync,
    pickDefinedAgentSdkOptions: mocks.pickDefinedAgentSdkOptions,
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
        process.env['COPILOT_BYOK_ENABLED'] = 'false';
        delete process.env['COPILOT_BYOK_PROFILE'];
        delete process.env['OPENROUTER_API_KEY'];
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
        expect(sessionOptions?.excludedTools).toEqual(['glob', 'view', 'web_fetch']);
    });

    it('recupera colisão de tools causada por enableConfigDiscovery desligando apenas a descoberta implícita', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        mocks.resumeOrCreateAgentSdkSession
            .mockRejectedValueOnce(new Error('Tool names must be unique across ALL loaded extensions'))
            .mockResolvedValueOnce({
                session: { sessionId: 'guarded-sess' },
                isResumed: false,
                model: 'auto',
            });

        await initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' });

        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledTimes(2);
        expect(mocks.resumeOrCreateAgentSdkSession.mock.calls[0]?.[2]).toEqual(
            expect.objectContaining({ enableConfigDiscovery: true }),
        );
        expect(mocks.resumeOrCreateAgentSdkSession.mock.calls[1]?.[2]).toEqual(
            expect.objectContaining({ enableConfigDiscovery: false }),
        );
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

    it('não reaproveita modelo concreto antigo quando next boot força sessão nova', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'old-sess',
            model: 'qwen3-coder-next',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 3,
            nextSdkSessionBoot: { mode: 'new' },
        });
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: { sessionId: 'fresh-sess' },
            isResumed: false,
        });

        const result = await initOrResumeSession(/** @type {any} */ ({}), {
            model: 'kilo-auto/free',
            reasoningEffort: 'high',
        });

        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledWith(
            expect.anything(),
            null,
            expect.objectContaining({ model: 'kilo-auto/free' }),
        );
        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'kilo-auto/free',
                sdkSessionBootDecision: expect.objectContaining({
                    outcome: 'created',
                    requestedMode: 'new',
                    reason: 'operator-next-boot-new-session',
                }),
                nextSdkSessionBoot: null,
            }),
            expect.objectContaining({ label: 'session.initializer.create' }),
        );
        expect(result).toEqual(expect.objectContaining({ model: 'kilo-auto/free' }));
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

    it('reattacha a mesma sessao SDK BYOK antiga quando o boot voltou ao SDK Copilot', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'byok-sess',
            model: 'shared-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            byokSessionBinding: {
                enabled: true,
                profile: 'provider-a',
                preset: 'openai-compatible',
                providerType: 'openai',
                baseUrl: 'https://provider-a.example/v1',
                model: 'shared-model',
            },
        });
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: {
                sessionId: 'byok-sess',
                getMessages: vi.fn(async () => []),
            },
            isResumed: true,
            model: 'auto',
        });

        await initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' });

        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledWith(
            expect.anything(),
            'byok-sess',
            expect.objectContaining({
                model: 'auto',
                provider: undefined,
                requireSameSession: true,
            }),
        );
        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                byokSessionBinding: null,
                sdkSessionBootDecision: expect.objectContaining({
                    outcome: 'resumed',
                    requestedMode: 'auto',
                    resumeCandidateSessionId: 'byok-sess',
                    reason: expect.stringContaining('same-session-provider-rebind:'),
                }),
            }),
            expect.objectContaining({ label: 'session.initializer.resume' }),
        );
    });

    it('explica quando resume explícito cai em criação de sessão nova', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'persisted-session',
            model: 'auto',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            nextSdkSessionBoot: {
                mode: 'resume',
                sessionId: 'listed-session',
            },
        });

        await initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' });

        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledWith(
            expect.anything(),
            'listed-session',
            expect.any(Object),
        );
        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                sdkSessionBootDecision: expect.objectContaining({
                    outcome: 'created',
                    requestedMode: 'resume',
                    resumeCandidateSessionId: 'listed-session',
                    reason: expect.stringContaining('sdk-resume-fallback-created-new-session'),
                }),
            }),
            expect.objectContaining({ label: 'session.initializer.create' }),
        );
    });

    it('reattacha mesma sessao e persiste binding redigido quando BYOK ativo encontra estado antigo sem binding', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const previous = Object.fromEntries(
            [
                'COPILOT_BYOK_ENABLED',
                'COPILOT_BYOK_PROFILE',
                'COPILOT_BYOK_PROVIDER_PRESET',
                'COPILOT_BYOK_BASE_URL',
                'COPILOT_BYOK_MODEL',
            ].map((key) => [key, process.env[key]]),
        );
        Object.assign(process.env, {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROFILE: '',
            COPILOT_BYOK_PROVIDER_PRESET: 'openai-compatible',
            COPILOT_BYOK_BASE_URL: 'https://provider-b.example/v1',
            COPILOT_BYOK_MODEL: 'shared-model',
        });
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'legacy-byok-sess',
            model: 'shared-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
        });
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: {
                sessionId: 'legacy-byok-sess',
                getMessages: vi.fn(async () => []),
            },
            isResumed: true,
            model: 'shared-model',
        });

        try {
            await initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' });
        } finally {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }

        expect(mocks.resumeOrCreateAgentSdkSession).toHaveBeenCalledWith(
            expect.anything(),
            'legacy-byok-sess',
            expect.objectContaining({
                model: 'shared-model',
                provider: expect.objectContaining({ baseUrl: 'https://provider-b.example/v1' }),
                requireSameSession: true,
            }),
        );
        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                byokSessionBinding: {
                    enabled: true,
                    profile: null,
                    preset: 'openai-compatible',
                    providerType: 'openai',
                    baseUrl: 'https://provider-b.example/v1',
                    model: 'shared-model',
                },
                sdkSessionBootDecision: expect.objectContaining({
                    outcome: 'resumed',
                    requestedMode: 'auto',
                    resumeCandidateSessionId: 'legacy-byok-sess',
                    reason: expect.stringContaining('same-session-provider-rebind:'),
                }),
            }),
            expect.objectContaining({ label: 'session.initializer.resume' }),
        );
    });

    it('seleciona ingress automaticamente quando o rebind direto foi marcado como não confiável', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const { defaultModelGatewayIngressRouteRegistry } = await import(
            '../../../src/copilot/model-gateway/ingress/index.js'
        );
        defaultModelGatewayIngressRouteRegistry.clear();
        process.env['OPENROUTER_API_KEY'] = 'upstream-secret';
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'previous-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            modelGatewayActiveRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
                wireApi: 'completions',
                directRebindReliable: false,
                routeProfile: 'repo_agent',
                updatedAt: Date.now(),
            },
        });
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: {
                sessionId: 'saved-sess',
                getMessages: vi.fn(async () => []),
            },
            isResumed: true,
        });

        await initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' });

        const options = mocks.resumeOrCreateAgentSdkSession.mock.calls.at(-1)?.[2];
        const routes = defaultModelGatewayIngressRouteRegistry.listRedacted();
        expect(options).toMatchObject({
            model: 'model-gateway-live',
            provider: {
                type: 'openai',
                apiKey: expect.stringMatching(/^mgw-local-[A-Za-z0-9_-]{43}$/u),
                baseUrl: expect.stringContaining('/v1/model-gateway-ingress/'),
            },
            requireSameSession: true,
        });
        expect(routes).toHaveLength(1);
        const [registeredRoute] = routes;
        if (!registeredRoute) throw new Error('Rota ingress não registrada.');
        expect(defaultModelGatewayIngressRouteRegistry.get(String(registeredRoute['routeId']))).toMatchObject({
            upstreamAuthHeaders: { authorization: 'Bearer upstream-secret' },
            ingressRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
        expect(mocks.persistState).toHaveBeenCalledWith(
            expect.objectContaining({
                modelGatewayActiveRoute: expect.objectContaining({
                    providerId: 'openrouter',
                    providerModel: 'openrouter/free',
                    bindingStrategy: 'ingress',
                    sdkVisibleModel: 'model-gateway-live',
                    requiresIngress: true,
                    requiresNewSession: false,
                    bindingDecision: expect.objectContaining({
                        strategy: 'ingress',
                        source: 'automatic_ingress_fallback',
                    }),
                }),
            }),
            expect.objectContaining({ label: 'session.initializer.resume' }),
        );
    });

    it('remove binding ingress preparado quando resume/create falha antes de aceitar a sessão', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const { defaultModelGatewayIngressRouteRegistry } = await import(
            '../../../src/copilot/model-gateway/ingress/index.js'
        );
        defaultModelGatewayIngressRouteRegistry.clear();
        process.env['OPENROUTER_API_KEY'] = 'upstream-secret';
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'previous-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            modelGatewayActiveRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
                wireApi: 'completions',
                directRebindReliable: false,
                routeProfile: 'repo_agent',
                updatedAt: Date.now(),
            },
        });
        mocks.resumeOrCreateAgentSdkSession.mockRejectedValueOnce(new Error('resume failed'));

        await expect(initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' })).rejects.toThrow(
            /resume failed/u,
        );

        expect(defaultModelGatewayIngressRouteRegistry.listRedacted()).toHaveLength(0);
        expect(mocks.persistState).not.toHaveBeenCalledWith(
            expect.objectContaining({ modelGatewayActiveRoute: expect.anything() }),
            expect.objectContaining({ label: 'session.initializer.resume' }),
        );
    });

    it('restaura binding ingress anterior quando a preparação substitutiva falha', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const {
            createModelGatewayIngressRoute,
            defaultModelGatewayIngressRouteRegistry,
        } = await import('../../../src/copilot/model-gateway/ingress/index.js');
        defaultModelGatewayIngressRouteRegistry.clear();
        const previousRoute = createModelGatewayIngressRoute({
            sessionId: 'saved-sess',
            publicBaseUrl: 'http://127.0.0.1:3009',
            route: {
                providerId: 'groq',
                providerModel: 'llama-old',
                baseUrl: 'https://api.groq.com/openai/v1',
                sdkRouteKey: 'saved-sess:live-provider',
                sdkVisibleModel: 'model-gateway-live',
                bindingStrategy: 'ingress',
            },
        });
        defaultModelGatewayIngressRouteRegistry.register({
            ingressRoute: previousRoute,
            localApiKey: 'previous-local-key',
            upstreamAuthHeaders: { authorization: 'Bearer previous-upstream' },
            expectedRevision: null,
        });
        process.env['OPENROUTER_API_KEY'] = 'replacement-upstream';
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'previous-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            modelGatewayActiveRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
                wireApi: 'completions',
                bindingStrategy: 'ingress',
                sdkRouteKey: 'saved-sess:live-provider',
                sdkVisibleModel: 'model-gateway-live',
                updatedAt: Date.now(),
            },
        });
        mocks.resumeOrCreateAgentSdkSession.mockRejectedValueOnce(new Error('replacement resume failed'));

        await expect(initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' })).rejects.toThrow(
            /replacement resume failed/u,
        );

        expect(defaultModelGatewayIngressRouteRegistry.findBySdkRouteKey('saved-sess:live-provider')).toMatchObject({
            revision: 3,
            localApiKey: 'previous-local-key',
            upstreamAuthHeaders: { authorization: 'Bearer previous-upstream' },
            ingressRoute: {
                providerId: 'groq',
                providerModel: 'llama-old',
            },
            metadata: {
                source: 'session.initializer.rollback',
                restoredFromRevision: 1,
                rollbackOfRevision: 2,
            },
        });
    });

    it('bloqueia rota sem binding seguro antes de chamar o SDK', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'previous-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            modelGatewayActiveRoute: {
                providerId: 'openai',
                providerModel: 'gpt-5.2-codex',
                providerType: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                wireApi: 'responses',
                directRebindReliable: false,
                updatedAt: Date.now(),
            },
        });

        await expect(initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' })).rejects.toThrow(
            /MODEL_GATEWAY_BINDING_STRATEGY_BLOCKED/u,
        );
        expect(mocks.resumeOrCreateAgentSdkSession).not.toHaveBeenCalled();
        expect(mocks.createAgentSdkSessionByClient).not.toHaveBeenCalled();
    });

    it('projeta rota Model Gateway persistida por ingress local quando bindingStrategy=ingress', async () => {
        const { initOrResumeSession } = await import('../../../src/copilot/agent/session/initializers/initializer.js');
        const { defaultModelGatewayIngressRouteRegistry } = await import(
            '../../../src/copilot/model-gateway/ingress/index.js'
        );
        defaultModelGatewayIngressRouteRegistry.clear();
        process.env['OPENROUTER_API_KEY'] = 'upstream-secret';
        mocks.readState.mockResolvedValueOnce({
            sessionId: 'saved-sess',
            model: 'previous-model',
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 1,
            modelGatewayActiveRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                baseUrl: 'https://openrouter.ai/api/v1',
                bindingStrategy: 'ingress',
                sdkRouteKey: 'saved-sess:live-provider',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
        mocks.resumeOrCreateAgentSdkSession.mockResolvedValueOnce({
            session: {
                sessionId: 'saved-sess',
                getMessages: vi.fn(async () => []),
            },
            isResumed: true,
        });

        await initOrResumeSession(/** @type {any} */ ({}), { model: 'auto' });

        const options = mocks.resumeOrCreateAgentSdkSession.mock.calls.at(-1)?.[2];
        const routes = defaultModelGatewayIngressRouteRegistry.listRedacted();
        expect(options).toMatchObject({
            model: 'model-gateway-live',
            provider: {
                type: 'openai',
                apiKey: expect.stringMatching(/^mgw-local-[A-Za-z0-9_-]{43}$/u),
                baseUrl: expect.stringContaining('/v1/model-gateway-ingress/'),
            },
        });
        expect(routes).toHaveLength(1);
        const [registeredRoute] = routes;
        if (!registeredRoute) throw new Error('Rota ingress não registrada.');
        expect(options.provider.baseUrl).toBe(registeredRoute['sdkBaseUrl']);
        expect(defaultModelGatewayIngressRouteRegistry.get(String(registeredRoute['routeId']))).toMatchObject({
            upstreamAuthHeaders: { authorization: 'Bearer upstream-secret' },
            ingressRoute: {
                providerId: 'openrouter',
                providerModel: 'openrouter/free',
                sdkVisibleModel: 'model-gateway-live',
            },
        });
    });
});
