// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

const { chmod, clearByokProviderModelHealth, discoverConfiguredByokModelsFromEnv, flushByokProviderHealth, listByokProviderModelHealth, listTerminalSdkSessionInventory, loadDotenv, probeTerminalConfiguredByokAgent, probeTerminalConfiguredByokChat, readByokProviderHealthState, readByokProviderModelHealth, readConfiguredByokProfilesFromEnv, readFile, readTerminalByokProjection, readTerminalRuntimeState, recordByokProviderModelAgentProbeFailure, recordByokProviderModelAgentProbeSuccess, recordByokProviderModelCallFailure, recordByokProviderModelCallSuccess, rename, setTerminalModelProjection, writeFile } =
    vi.hoisted(() => ({
        chmod: vi.fn(),
        clearByokProviderModelHealth: vi.fn(),
        discoverConfiguredByokModelsFromEnv: vi.fn(),
        flushByokProviderHealth: vi.fn(() => Promise.resolve()),
        listByokProviderModelHealth: vi.fn(() => []),
        listTerminalSdkSessionInventory: vi.fn(() =>
            Promise.resolve({
                currentSessionId: null,
                lastSessionId: null,
                foregroundSessionId: null,
                persistedByokBinding: null,
                lastBootDecision: null,
                sessions: [],
            }),
        ),
        loadDotenv: vi.fn(),
        probeTerminalConfiguredByokAgent: vi.fn(),
        probeTerminalConfiguredByokChat: vi.fn(),
        readByokProviderHealthState: vi.fn(() => ({
            enabled: false,
            path: null,
            loaded: true,
            records: 0,
            persistedRecords: 0,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        })),
        readByokProviderModelHealth: vi.fn(() => null),
        readConfiguredByokProfilesFromEnv: vi.fn(() => ({})),
        readFile: vi.fn(),
        readTerminalByokProjection: vi.fn(),
        readTerminalRuntimeState: vi.fn(() => ({ contextWindow: null })),
        recordByokProviderModelCallFailure: vi.fn(),
        recordByokProviderModelCallSuccess: vi.fn(),
        recordByokProviderModelAgentProbeFailure: vi.fn(),
        recordByokProviderModelAgentProbeSuccess: vi.fn(),
        rename: vi.fn(),
        setTerminalModelProjection: vi.fn(),
        writeFile: vi.fn(),
    }));

vi.mock('node:fs/promises', () => ({
    default: { readFile, writeFile, rename, chmod },
    readFile,
    writeFile,
    rename,
    chmod,
}));

vi.mock('dotenv', () => ({
    config: loadDotenv,
}));

vi.mock('#copilot/config', () => ({
    discoverConfiguredByokModelsFromEnv,
    readConfiguredByokProfilesFromEnv,
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    probeTerminalConfiguredByokChat,
    probeTerminalConfiguredByokAgent,
    listTerminalSdkSessionInventory,
    readTerminalByokProjection,
    readTerminalRuntimeState,
    setTerminalModelProjection,
}));

vi.mock('../../../../src/copilot/terminal/state/byok-provider-health.js', () => ({
    clearByokProviderModelHealth,
    flushByokProviderHealth,
    listByokProviderModelHealth,
    readByokProviderHealthState,
    readByokProviderModelHealth,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
    recordByokProviderModelAgentProbeFailure,
    recordByokProviderModelAgentProbeSuccess,
}));

const { cmdByok } = await import('../../../../src/copilot/terminal/commands/byok.js');

const BASE_PROJECTION = Object.freeze({
    envKeys: Object.freeze(['COPILOT_BYOK_ENABLED', 'COPILOT_BYOK_PROFILE', 'KILO_API_KEY']),
    models: Object.freeze([]),
    profiles: Object.freeze([]),
    summary: Object.freeze({
        enabled: false,
        ready: false,
        profile: null,
        preset: null,
        providerType: null,
        baseUrl: null,
        model: null,
        wireApi: null,
        azureApiVersion: null,
        auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
        modelList: { configured: false, count: 0 },
        capabilities: { reasoningEffort: false, vision: false, contextWindowTokens: 128000 },
        warnings: [],
        errors: [],
    }),
});

/**
 * @param {Partial<typeof BASE_PROJECTION>} [overrides]
 */
function mockProjection(overrides = {}) {
    readTerminalByokProjection.mockReturnValue({
        ...BASE_PROJECTION,
        ...overrides,
        summary: { ...BASE_PROJECTION.summary, ...(overrides.summary ?? {}) },
    });
}

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    return {
        println: vi.fn((/** @type {string} */ text) => lines.push(text)),
        output: () => lines.join('\n'),
    };
}

describe('terminal /byok command', () => {
    afterEach(() => {
        discoverConfiguredByokModelsFromEnv.mockReset();
        chmod.mockReset();
        chmod.mockResolvedValue(undefined);
        clearByokProviderModelHealth.mockReset();
        flushByokProviderHealth.mockReset();
        flushByokProviderHealth.mockResolvedValue(undefined);
        listByokProviderModelHealth.mockReset();
        listByokProviderModelHealth.mockReturnValue([]);
        listTerminalSdkSessionInventory.mockReset();
        listTerminalSdkSessionInventory.mockResolvedValue({
            currentSessionId: null,
            lastSessionId: null,
            foregroundSessionId: null,
            persistedByokBinding: null,
            lastBootDecision: null,
            sessions: [],
        });
        loadDotenv.mockReset();
        probeTerminalConfiguredByokChat.mockReset();
        probeTerminalConfiguredByokAgent.mockReset();
        readByokProviderHealthState.mockReset();
        readByokProviderHealthState.mockReturnValue({
            enabled: false,
            path: null,
            loaded: true,
            records: 0,
            persistedRecords: 0,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        });
        readByokProviderModelHealth.mockReset();
        readByokProviderModelHealth.mockReturnValue(null);
        readConfiguredByokProfilesFromEnv.mockReset();
        readConfiguredByokProfilesFromEnv.mockReturnValue({});
        readFile.mockReset();
        readTerminalByokProjection.mockReset();
        readTerminalRuntimeState.mockReset();
        readTerminalRuntimeState.mockReturnValue({ contextWindow: null });
        recordByokProviderModelCallFailure.mockReset();
        recordByokProviderModelCallSuccess.mockReset();
        recordByokProviderModelAgentProbeFailure.mockReset();
        recordByokProviderModelAgentProbeSuccess.mockReset();
        rename.mockReset();
        setTerminalModelProjection.mockReset();
        writeFile.mockReset();
        delete process.env['COPILOT_BYOK_ENABLED'];
        delete process.env['COPILOT_BYOK_PROFILE'];
        delete process.env['COPILOT_BYOK_PROVIDER_PRESET'];
        delete process.env['COPILOT_BYOK_PROVIDER_TYPE'];
        delete process.env['COPILOT_BYOK_MODEL'];
        delete process.env['COPILOT_BYOK_BASE_URL'];
        delete process.env['COPILOT_BYOK_WIRE_API'];
        delete process.env['COPILOT_BYOK_HEADERS_JSON'];
    });

    it('mostra .env.local como arquivo canônico sem expor segredos', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'anthropic/claude-sonnet-4.5',
                auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                modelList: { configured: true, count: 1 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('BYOK status');
        expect(ctx.output()).toContain('.env.local');
        expect(ctx.output()).toContain('bearer=');
        expect(ctx.output()).toContain('prepared:');
        expect(ctx.output()).toContain('live binding:');
        expect(ctx.output()).toContain('/session sdk next new');
        expect(ctx.output()).toContain('/restart reinicia só o dialog loop');
        expect(ctx.output()).not.toContain('secret');
    });

    it('distingue seleção BYOK preparada do provider vivo que ainda precisa de novo boot', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'ollama-cloud',
                preset: 'ollama-cloud',
                providerType: 'openai',
                baseUrl: 'https://ollama.com/v1',
                model: 'qwen3-coder-next',
            },
        });
        listTerminalSdkSessionInventory.mockResolvedValueOnce({
            currentSessionId: 'sdk-kilo-live',
            lastSessionId: 'sdk-kilo-live',
            foregroundSessionId: 'sdk-kilo-live',
            persistedByokBinding: {
                enabled: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
            lastBootDecision: null,
            sessions: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('BYOK profile=ollama-cloud');
        expect(ctx.output()).toContain('BYOK profile=kilo');
        expect(ctx.output()).toContain('cruzam provider/perfil');
        expect(ctx.output()).toContain('/session sdk next new');
    });

    it('torna acionável o health falho da seleção BYOK ativa sem trocar modelo silenciosamente', async () => {
        const now = Date.now();
        readByokProviderModelHealth.mockImplementation(({ model }) =>
            model === 'deepseek/deepseek-v4-flash:free'
                ? {
                      key: 'openrouter-free|openrouter|deepseek/deepseek-v4-flash:free',
                      profile: 'openrouter-free',
                      provider: 'openrouter',
                      model,
                      lastStatus: 'failed',
                      failureCount: 2,
                      successCount: 0,
                      lastFailureAt: now,
                      lastSuccessAt: null,
                      lastMessage: 'timeout',
                      lastErrorContext: 'byok_probe',
                      agentProbeStatus: 'failed',
                      agentProbeFailureCount: 1,
                      agentProbeSuccessCount: 0,
                      lastAgentProbeFailureAt: now,
                      lastAgentProbeSuccessAt: null,
                      lastAgentProbeMessage: 'timeout',
                      lastAgentProbeErrorContext: 'byok_agent_probe',
                  }
                : null,
        );
        mockProjection({
            models: [
                {
                    id: 'deepseek/deepseek-v4-flash:free',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                },
                {
                    id: 'openrouter/free',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 128000 } },
                },
            ],
            summary: {
                enabled: true,
                ready: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'deepseek/deepseek-v4-flash:free',
                auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                modelList: { configured: true, count: 2 },
                capabilities: { reasoningEffort: true, vision: true, contextWindowTokens: 128000 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).toContain('healthGate: seleção ativa com falha recente');
        expect(ctx.output()).toContain('catálogo disponível não equivale a runtime saudável');
        expect(ctx.output()).toContain('/byok probe agent profile:openrouter-free model:openrouter/free');
        expect(ctx.output()).toContain('/byok use openrouter-free -> /byok model openrouter/free');
    });

    it('não herda health de outro modelo do profile quando há override BYOK ativo', async () => {
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'openrouter-free|openrouter|openrouter/free',
                profile: 'openrouter-free',
                provider: 'openrouter',
                model: 'openrouter/free',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 4,
                lastFailureAt: null,
                lastSuccessAt: Date.now(),
                lastMessage: null,
                lastErrorContext: null,
                agentProbeStatus: 'ok',
                agentProbeFailureCount: 0,
                agentProbeSuccessCount: 2,
                lastAgentProbeFailureAt: null,
                lastAgentProbeSuccessAt: Date.now(),
                lastAgentProbeMessage: null,
                lastAgentProbeErrorContext: null,
            },
        ]);
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'kilo-auto/free',
                auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                modelList: { configured: true, count: 2 },
                capabilities: { reasoningEffort: true, vision: true, contextWindowTokens: 128000 },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'status');

        expect(ctx.output()).not.toContain('chatHealth:');
        expect(ctx.output()).not.toContain('agentHealth:');
    });

    it('lista perfis redigidos', async () => {
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'anthropic/claude-sonnet-4.5',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['owner'],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'profiles');

        expect(ctx.output()).toContain('kilo');
        expect(ctx.output()).toContain('meta=owner');
        expect(ctx.output()).not.toContain('secret');
    });

    it('roda probe descartável e registra chat health sem expor segredo', async () => {
        mockProjection();
        probeTerminalConfiguredByokChat.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 123,
            model: 'probe-model',
            profile: 'groq-free',
            preset: 'groq',
            providerType: 'openai',
            deltaCount: 2,
            deltaChars: 13,
            finalChars: 13,
            observedFinalEvent: true,
            sessionId: 'tmp-probe',
            errors: [],
            warnings: ['catalogo remoto'],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe profile:groq-free model:probe-model timeout:9000');

        expect(probeTerminalConfiguredByokChat).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'groq-free' }),
                model: 'probe-model',
                timeoutMs: 9000,
            }),
        );
        expect(recordByokProviderModelCallSuccess).toHaveBeenCalledWith({
            profile: 'groq-free',
            provider: 'groq',
            model: 'probe-model',
            successContext: 'byok_probe',
        });
        expect(flushByokProviderHealth).toHaveBeenCalled();
        expect(ctx.output()).toContain('sessão SDK descartável');
        expect(ctx.output()).toContain('deltas=2/13 chars');
        expect(ctx.output()).not.toContain('token');
    });

    it('roda agent probe descartável e separa compatibilidade agente do chat canário', async () => {
        mockProjection();
        probeTerminalConfiguredByokAgent.mockResolvedValue({
            ok: false,
            status: 'tool-missing',
            elapsedMs: 456,
            model: 'chat-only-model',
            profile: 'kilo',
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 3,
            deltaChars: 21,
            finalChars: 80,
            observedFinalEvent: true,
            toolCallCount: 0,
            userInputRequestCount: 0,
            userInputAnswerCount: 0,
            sessionId: 'tmp-agent-probe',
            errors: [],
            warnings: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe agent profile:kilo model:chat-only-model timeout:12000');

        expect(probeTerminalConfiguredByokAgent).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'kilo' }),
                model: 'chat-only-model',
                timeoutMs: 12000,
            }),
        );
        expect(recordByokProviderModelAgentProbeFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                profile: 'kilo',
                provider: 'kilo-code',
                model: 'chat-only-model',
                message: 'agent probe tool-missing',
            }),
        );
        expect(ctx.output()).toContain('BYOK agent probe');
        expect(ctx.output()).toContain('toolCalls=0');
        expect(ctx.output()).toContain('marker=0');
        expect(ctx.output()).toContain('read=0');
        expect(ctx.output()).toContain('tools representativas + ask_user');
        expect(ctx.output()).not.toContain('token');
    });

    it('explica bloqueio externo de credito/cota em probe BYOK sem degradar o diagnostico em erro cru', async () => {
        mockProjection();
        probeTerminalConfiguredByokAgent.mockResolvedValue({
            ok: false,
            status: 'failed',
            elapsedMs: 456,
            model: 'metered-model',
            profile: 'chutes-ai',
            preset: 'chutes',
            providerType: 'openai',
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            observedFinalEvent: false,
            toolCallCount: 0,
            markerToolCallCount: 0,
            readToolCallCount: 0,
            userInputRequestCount: 0,
            userInputAnswerCount: 0,
            sessionId: 'tmp-agent-probe',
            errors: ['402 402 status code (no body)'],
            warnings: [],
            providerFailure: {
                kind: 'credits',
                message: '402 402 status code (no body)',
                statusCode: 402,
                errorContext: 'provider.credits',
                operatorLabel: 'provider BYOK recusou a chamada por credito, saldo ou cota (HTTP 402)',
                operatorAction: 'troque para modelo free e valide com /byok probe agent',
                external: true,
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe agent profile:chutes-ai model:metered-model');

        expect(recordByokProviderModelAgentProbeFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                profile: 'chutes-ai',
                provider: 'chutes',
                model: 'metered-model',
                errorContext: 'provider.credits',
            }),
        );
        expect(ctx.output()).toContain('diagnóstico: provider BYOK recusou a chamada por credito');
        expect(ctx.output()).toContain('ação: troque para modelo free');
        expect(ctx.output()).toContain('erro: 402 402 status code (no body)');
    });

    it('sonda shortlist recomendada sem trocar a sessão viva e preserva profile/modelo de cada candidato', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'kilo/model-a',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        profile: 'kilo',
                        provider: 'kilo-code',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter/model-b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 180000 } },
                    byok: {
                        freeTier: true,
                        profile: 'openrouter-free',
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        probeTerminalConfiguredByokAgent
            .mockResolvedValueOnce({
                ok: true,
                status: 'ok',
                elapsedMs: 111,
                model: 'kilo/model-a',
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                deltaCount: 2,
                deltaChars: 16,
                finalChars: 24,
                observedFinalEvent: true,
                toolCallCount: 2,
                markerToolCallCount: 1,
                readToolCallCount: 1,
                userInputRequestCount: 1,
                userInputAnswerCount: 1,
                sessionId: 'tmp-kilo-shortlist',
                errors: [],
                warnings: [],
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 'ok',
                elapsedMs: 222,
                model: 'openrouter/model-b',
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                deltaCount: 3,
                deltaChars: 20,
                finalChars: 30,
                observedFinalEvent: true,
                toolCallCount: 2,
                markerToolCallCount: 1,
                readToolCallCount: 1,
                userInputRequestCount: 1,
                userInputAnswerCount: 1,
                sessionId: 'tmp-openrouter-shortlist',
                errors: [],
                warnings: [],
            });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe shortlist free reasoning safe 2 timeout:15000');

        expect(probeTerminalConfiguredByokAgent).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'kilo' }),
                model: 'kilo/model-a',
                timeoutMs: 15000,
            }),
        );
        expect(probeTerminalConfiguredByokAgent).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                env: expect.objectContaining({ COPILOT_BYOK_PROFILE: 'openrouter-free' }),
                model: 'openrouter/model-b',
                timeoutMs: 15000,
            }),
        );
        expect(recordByokProviderModelAgentProbeSuccess).toHaveBeenCalledTimes(2);
        expect(ctx.output()).toContain('BYOK shortlist agent probe');
        expect(ctx.output()).toContain('kilo/model-a');
        expect(ctx.output()).toContain('openrouter/model-b');
        expect(ctx.output()).toContain('Shortlist encerrada: ok=2/2');
        expect(ctx.output()).toContain('/byok recommend ... safe');
        expect(ctx.output()).not.toContain('tmp-kilo-shortlist');
    });

    it('explica cobertura por perfil na shortlist agregada antes de sondar o top-N', async () => {
        discoverConfiguredByokModelsFromEnv
            .mockResolvedValueOnce({
                models: [
                    {
                        id: 'kilo/ranked',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: false },
                            limits: { max_context_window_tokens: 200000 },
                        },
                        byok: { freeTier: true, rateLimits: { maxRequestTokens: 128000 } },
                    },
                ],
                source: 'remote',
                endpoint: 'https://kilo.example/v1/models',
                fromCache: false,
                error: null,
            })
            .mockResolvedValueOnce({
                models: [
                    {
                        id: 'groq/compact',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: false },
                            limits: { max_context_window_tokens: 128000 },
                        },
                        byok: { freeTier: true, rateLimits: { maxRequestTokens: 6000 } },
                    },
                ],
                source: 'remote',
                endpoint: 'https://groq.example/v1/models',
                fromCache: false,
                error: null,
            });
        probeTerminalConfiguredByokAgent.mockResolvedValue({
            ok: true,
            status: 'ok',
            elapsedMs: 111,
            model: 'kilo/ranked',
            profile: 'kilo',
            preset: 'kilo-code',
            providerType: 'openai',
            deltaCount: 2,
            deltaChars: 16,
            finalChars: 16,
            observedFinalEvent: true,
            toolCallCount: 2,
            markerToolCallCount: 1,
            readToolCallCount: 1,
            userInputRequestCount: 1,
            userInputAnswerCount: 1,
            sessionId: 'tmp-kilo-ranked',
            errors: [],
            warnings: [],
        });
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'kilo/ranked',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'groq/compact',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe shortlist all-providers free reasoning safe 1');

        expect(probeTerminalConfiguredByokAgent).toHaveBeenCalledTimes(1);
        expect(ctx.output()).toContain('Cobertura por perfil antes das probes');
        expect(ctx.output()).toContain('kilo: catalogo=1 · elegiveis=1 · shortlist=1');
        expect(ctx.output()).toContain('groq-free: catalogo=1 · safe removeu=1');
        expect(ctx.output()).toContain('/byok models all-providers provider:groq-free 5');
    });

    it('não degrada health real quando admission bloqueia a probe antes do provider', async () => {
        mockProjection();
        probeTerminalConfiguredByokChat.mockResolvedValue({
            ok: false,
            status: 'admission-blocked',
            elapsedMs: 1,
            model: 'tiny-limit-model',
            profile: 'groq-free',
            preset: 'groq',
            providerType: 'openai',
            deltaCount: 0,
            deltaChars: 0,
            finalChars: 0,
            observedFinalEvent: false,
            sessionId: null,
            errors: ['probe chat estimada 16384 tokens > limite BYOK 6000'],
            warnings: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'probe chat profile:groq-free model:tiny-limit-model');

        expect(recordByokProviderModelCallFailure).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('admission-blocked');
        expect(ctx.output()).toContain('health real do modelo não foi degradado');
    });

    it('lista providers disponíveis com comandos operacionais redigidos', async () => {
        const now = Date.now();
        readConfiguredByokProfilesFromEnv.mockReturnValue({
            'openrouter-free': { metadata: { freeFirst: true } },
            'groq-free': { metadata: { freeLimit: '6k TPM observed on current plan' } },
        });
        readByokProviderModelHealth.mockReturnValue(null);
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'groq-free|groq|openai/gpt-oss-120b',
                profile: 'groq-free',
                provider: 'groq',
                model: 'openai/gpt-oss-120b',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 2,
                lastFailureAt: null,
                lastSuccessAt: now,
                lastMessage: null,
                lastErrorContext: null,
            },
        ]);
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'z-ai/glm-4.5-air:free',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: ['tier', 'owner'],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'openai/gpt-oss-120b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['limits'],
                },
            ],
            summary: {
                enabled: true,
                ready: true,
                profile: 'groq-free',
                preset: 'groq',
                providerType: 'openai',
                model: 'openai/gpt-oss-120b',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'providers');

        expect(ctx.output()).toContain('BYOK providers');
        expect(ctx.output()).toContain('openrouter-free');
        expect(ctx.output()).toContain('groq-free');
        expect(ctx.output()).toContain('← ativo');
        expect(ctx.output()).toContain('/byok use groq-free');
        expect(ctx.output()).toContain('/byok models refresh provider:groq');
        expect(ctx.output()).toContain('meta=tier,owner');
        expect(ctx.output()).toContain('cost=profile-free');
        expect(ctx.output()).toContain('chat=ok');
        expect(ctx.output()).not.toContain('secret');
    });

    it('mostra health operacional persistido de BYOK', async () => {
        readByokProviderHealthState.mockReturnValue({
            enabled: true,
            path: 'data/copilot-terminal/byok-provider-health.json',
            loaded: true,
            records: 1,
            persistedRecords: 1,
            flushScheduled: false,
            flushInFlight: false,
            dirty: false,
            error: null,
        });
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'kilo|kilo-code|kilo-auto/free',
                profile: 'kilo',
                provider: 'kilo-code',
                model: 'kilo-auto/free',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 2,
                lastFailureAt: null,
                lastSuccessAt: Date.now(),
                lastMessage: null,
                lastErrorContext: null,
            },
        ]);
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health');

        expect(ctx.output()).toContain('BYOK operational health');
        expect(ctx.output()).toContain('byok-provider-health.json');
        expect(ctx.output()).toContain('chat=ok');
    });

    it('limpa health operacional BYOK quando solicitado', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'health clear');

        expect(clearByokProviderModelHealth).toHaveBeenCalledOnce();
        expect(flushByokProviderHealth).toHaveBeenCalledOnce();
        expect(ctx.output()).toContain('BYOK operational health limpo');
    });

    it('ativa perfil no processo atual', async () => {
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'anthropic/claude-sonnet-4.5',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'use kilo');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBe('kilo');
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('BYOK status');
    });

    it('desativa BYOK e volta para SDK', async () => {
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'use sdk');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('false');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('SDK Copilot');
    });

    it('muda modelo BYOK no processo atual', async () => {
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_MODEL']).toBe('anthropic/claude-sonnet-4.5');
        expect(setTerminalModelProjection).not.toHaveBeenCalled();
    });

    it('troca modelo na sessão viva quando o provider BYOK bound é o mesmo', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
        });
        listTerminalSdkSessionInventory.mockResolvedValue({
            currentSessionId: 'sdk-kilo',
            lastSessionId: 'sdk-kilo',
            foregroundSessionId: 'sdk-kilo',
            persistedByokBinding: {
                enabled: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
            lastBootDecision: null,
            sessions: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(setTerminalModelProjection).toHaveBeenCalledWith('anthropic/claude-sonnet-4.5');
        expect(ctx.output()).toContain('Modelo BYOK solicitado na sessão viva');
        expect(ctx.output()).toContain('Provider/perfil foram preservados');
    });

    it('não atravessa provider com setModel quando o binding BYOK vivo diverge', async () => {
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'kilo-auto/free',
            },
        });
        listTerminalSdkSessionInventory.mockResolvedValue({
            currentSessionId: 'sdk-openrouter',
            lastSessionId: 'sdk-openrouter',
            foregroundSessionId: 'sdk-openrouter',
            persistedByokBinding: {
                enabled: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'openrouter/free',
            },
            lastBootDecision: null,
            sessions: [],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'model anthropic/claude-sonnet-4.5');

        expect(setTerminalModelProjection).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Sessão viva não está bound ao mesmo provider BYOK');
    });

    it('lista modelos descobertos automaticamente pelo provider', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'remote-a',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: {
                        freeTier: true,
                        pricing: { prompt: 0, completion: 0, request: null },
                        provider: 'fixture',
                        inputModalities: ['text', 'image'],
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000, requestsPerMinute: 30 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.kilo.ai/api/gateway/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models');

        expect(ctx.output()).toContain('fonte=provider');
        expect(ctx.output()).toContain('remote-a');
        expect(ctx.output()).toContain('free');
        expect(ctx.output()).toContain('provider=fixture');
        expect(ctx.output()).toContain('ctx=200000');
        expect(ctx.output()).toContain('maxReq=6000');
        expect(ctx.output()).toContain('TPM=6000');
    });

    it('ranqueia modelos BYOK free e capazes antes de modelos pagos ou desconhecidos', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'paid-small',
                    capabilities: { supports: { reasoningEffort: false, vision: false }, limits: { max_context_window_tokens: 8000 } },
                    byok: { freeTier: false, pricing: { prompt: 0.1, completion: 0.2, request: null } },
                },
                {
                    id: 'free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: true, pricing: { prompt: 0, completion: 0, request: null } },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models');

        expect(ctx.output().indexOf('free-reasoning')).toBeLessThan(ctx.output().indexOf('paid-small'));
        expect(ctx.output()).toContain('ordem=free/capability/context');
    });

    it('limita a página padrão de modelos BYOK e permite ampliar por número', async () => {
        const discoverModels = discoverConfiguredByokModelsFromEnv;
        const models = Array.from({ length: 30 }, (_, index) => ({
            id: `remote-${index + 1}`,
            capabilities: {
                supports: { reasoningEffort: true, vision: false },
                limits: { max_context_window_tokens: 200000 },
            },
        }));
        discoverModels.mockResolvedValue({
            models,
            source: 'remote',
            endpoint: 'https://api.kilo.ai/api/gateway/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const defaultCtx = mockCtx();

        await cmdByok({ println: defaultCtx.println }, 'models refresh');

        expect(defaultCtx.output()).toContain('remote-24');
        expect(defaultCtx.output()).not.toContain('remote-25');
        expect(defaultCtx.output()).toContain('exibindo 24/30');

        const expandedCtx = mockCtx();
        await cmdByok({ println: expandedCtx.println }, 'models refresh 26');

        expect(expandedCtx.output()).toContain('remote-26');
        expect(expandedCtx.output()).not.toContain('remote-27');
        expect(expandedCtx.output()).toContain('exibindo 26/30');
    });

    it('filtra catálogo BYOK por provider, gratuidade, capacidade e limite', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter/free-low',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 4000 },
                    },
                },
                {
                    id: 'groq/free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        provider: 'groq',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter/paid-vision',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'openrouter' },
                },
            ],
            source: 'remote',
            endpoint: 'https://openrouter.ai/api/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models provider:openrouter free reasoning safe 10');

        expect(ctx.output()).toContain('filtros=provider:openrouter,free,reasoning,safe');
        expect(ctx.output()).toContain('openrouter/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter/free-low');
        expect(ctx.output()).not.toContain('groq/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter/paid-vision');
    });

    it('consulta modelos em todos os perfis BYOK sem trocar o provider ativo', async () => {
        discoverConfiguredByokModelsFromEnv.mockImplementation(async (env) => {
            const profile = env?.COPILOT_BYOK_PROFILE;
            return {
                models: [
                    {
                        id: profile === 'groq-free' ? 'groq/free-reasoning' : 'openrouter/free-reasoning',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: profile !== 'groq-free' },
                            limits: { max_context_window_tokens: profile === 'groq-free' ? 131072 : 200000 },
                        },
                        byok: {
                            freeTier: true,
                            provider: profile === 'groq-free' ? 'groq' : 'openrouter',
                            rateLimits: { maxRequestTokens: profile === 'groq-free' ? 32000 : 64000 },
                        },
                    },
                ],
                source: 'remote',
                endpoint: `https://${profile}.example/v1/models`,
                fromCache: false,
                error: null,
            };
        });
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'openrouter/default',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'groq/default',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'openrouter-free' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers free reasoning safe 10');

        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledTimes(2);
        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledWith(
            expect.objectContaining({ COPILOT_BYOK_PROFILE: 'openrouter-free', COPILOT_BYOK_ENABLED: 'true' }),
            expect.objectContaining({ forceRefresh: false }),
        );
        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledWith(
            expect.objectContaining({ COPILOT_BYOK_PROFILE: 'groq-free', COPILOT_BYOK_ENABLED: 'true' }),
            expect.objectContaining({ forceRefresh: false }),
        );
        expect(ctx.output()).toContain('filtros=all-providers,free,reasoning,safe');
        expect(ctx.output()).toContain('perfis=2');
        expect(ctx.output()).toContain('openrouter/free-reasoning');
        expect(ctx.output()).toContain('groq/free-reasoning');
        expect(ctx.output()).toContain('profile=openrouter-free');
        expect(ctx.output()).toContain('profile=groq-free');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
    });

    it('agrupa modelos repetidos entre providers preservando variantes operacionais', async () => {
        discoverConfiguredByokModelsFromEnv.mockImplementation(async (env) => {
            const profile = env?.COPILOT_BYOK_PROFILE;
            return {
                models: [
                    {
                        id: 'shared/free-model',
                        capabilities: {
                            supports: { reasoningEffort: true, vision: false },
                            limits: { max_context_window_tokens: 128000 },
                        },
                        byok: {
                            freeTier: true,
                            provider: profile === 'groq-free' ? 'groq' : 'openrouter',
                            rateLimits: { maxRequestTokens: 64000 },
                        },
                    },
                ],
                source: 'remote',
                endpoint: `https://${profile}.example/v1/models`,
                fromCache: false,
                error: null,
            };
        });
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'shared/free-model',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'shared/free-model',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers grouped free reasoning safe 10');

        expect(ctx.output()).toContain('(1 grupos/2)');
        expect(ctx.output()).toContain('shared/free-model');
        expect(ctx.output()).toContain('variants=openrouter-free/openrouter|groq-free/groq');
    });

    it('recomenda em todos os perfis filtrando o provider antes da descoberta', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'groq/free-reasoning',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: { freeTier: true, provider: 'groq', rateLimits: { maxRequestTokens: 64000 } },
                },
            ],
            source: 'remote-cache',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: true,
            error: null,
        });
        mockProjection({
            profiles: [
                {
                    name: 'openrouter-free',
                    preset: 'openrouter',
                    providerType: 'openai',
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'openrouter/default',
                    auth: { apiKeyConfigured: true, bearerTokenConfigured: false, headersConfigured: false },
                    metadataKeys: [],
                },
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'groq/default',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend all-providers provider:groq free reasoning safe 5');

        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledTimes(1);
        expect(discoverConfiguredByokModelsFromEnv).toHaveBeenCalledWith(
            expect.objectContaining({ COPILOT_BYOK_PROFILE: 'groq-free' }),
            expect.any(Object),
        );
        expect(ctx.output()).toContain('filtros=all-providers,provider:groq,free,reasoning,safe');
        expect(ctx.output()).toContain('groq/free-reasoning');
        expect(ctx.output()).not.toContain('openrouter');
        expect(ctx.output()).toContain('/byok probe agent profile:groq-free model:groq/free-reasoning');
        expect(ctx.output()).toContain('/byok use groq-free -> /byok model groq/free-reasoning');
    });

    it('trata plano gratuito declarado no perfil como profile-free sem mascarar custo por modelo desconhecido', async () => {
        readConfiguredByokProfilesFromEnv.mockReturnValue({
            'groq-free': {
                preset: 'groq',
                metadata: {
                    freeLimit: '6k TPM observed on current plan',
                },
            },
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'qwen/qwen3-32b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: null,
                        provider: 'groq',
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection({
            profiles: [
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'qwen/qwen3-32b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['freeLimit'],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'groq-free', preset: 'groq', providerType: 'openai' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers provider:groq free reasoning 5');

        expect(ctx.output()).toContain('qwen/qwen3-32b');
        expect(ctx.output()).toContain('profile-free');
        expect(ctx.output()).toContain('freeHint=6k TPM observed on current plan');
        expect(ctx.output()).not.toContain('Nenhum modelo BYOK encontrado');
    });

    it('avisa quando o modelo configurado sumiu do catálogo remoto autoritativo', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'provider/current-model',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 128000 },
                    },
                    byok: { freeTier: true, provider: 'chutes', rateLimits: { maxRequestTokens: 64000 } },
                },
            ],
            source: 'remote',
            endpoint: 'https://llm.chutes.ai/v1/models',
            fromCache: false,
            error: null,
            configuredModel: {
                id: 'provider/stale-model',
                inCatalog: false,
                authoritative: true,
            },
        });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'chutes-ai',
                preset: 'chutes',
                providerType: 'openai',
                model: 'provider/stale-model',
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models refresh');

        expect(ctx.output()).toContain("model configurado 'provider/stale-model' nao apareceu no catalogo remoto atual");
        expect(ctx.output()).toContain('/byok probe agent profile:chutes-ai model:<id>');
        expect(ctx.output()).toContain('provider/current-model');
    });

    it('explica quando o filtro safe remove modelos BYOK existentes por limites baixos', async () => {
        readConfiguredByokProfilesFromEnv.mockReturnValue({
            'groq-free': {
                metadata: { freeLimit: '6k TPM observed on current plan' },
            },
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'qwen/qwen3-32b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: null,
                        provider: 'groq',
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection({
            profiles: [
                {
                    name: 'groq-free',
                    preset: 'groq',
                    providerType: 'openai',
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'qwen/qwen3-32b',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: ['freeLimit'],
                },
            ],
            summary: { enabled: true, ready: true, profile: 'groq-free', preset: 'groq', providerType: 'openai' },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models all-providers provider:groq free reasoning safe 5');

        expect(ctx.output()).toContain('Nenhum modelo BYOK encontrado');
        expect(ctx.output()).toContain('O filtro safe removeu 1 candidato');
        expect(ctx.output()).toContain('qwen/qwen3-32b');
        expect(ctx.output()).toContain('baixo para turno real');
    });

    it('recomenda modelos BYOK com filtros e alerta limites baixos', async () => {
        const now = Date.now();
        readByokProviderModelHealth.mockImplementation(({ model }) =>
            model === 'free-comfortable'
                ? {
                      key: 'openrouter|openrouter|free-comfortable',
                      profile: null,
                      provider: 'openrouter',
                      model,
                      lastStatus: 'ok',
                      failureCount: 0,
                      successCount: 1,
                      lastFailureAt: null,
                      lastSuccessAt: now,
                      lastMessage: null,
                      lastErrorContext: null,
                      agentProbeStatus: 'ok',
                      agentProbeFailureCount: 0,
                      agentProbeSuccessCount: 1,
                      lastAgentProbeFailureAt: null,
                      lastAgentProbeSuccessAt: now,
                  }
                : null,
        );
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'free-low-limit',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                        provider: 'groq',
                    },
                },
                {
                    id: 'free-comfortable',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 64000, tokensPerMinute: 64000 },
                        provider: 'openrouter',
                    },
                },
                {
                    id: 'paid-vision',
                    capabilities: { supports: { reasoningEffort: true, vision: true }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'paid' },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 2');

        expect(ctx.output()).toContain('BYOK recommend');
        expect(ctx.output()).toContain('free-comfortable');
        expect(ctx.output()).not.toContain('free-low-limit');
        expect(ctx.output()).not.toContain('paid-vision');
        expect(ctx.output()).toContain('ok para uso geral');
        expect(ctx.output()).toContain('/byok probe agent model:free-comfortable');
        expect(ctx.output()).toContain('live fake descartável');
    });

    it('na recomendacao safe exige probe agente positivo antes de promover modelo ao operador', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/unverified',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 128000 },
                        provider: 'openrouter',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 2');

        expect(ctx.output()).toContain('sem probe agente positivo');
        expect(ctx.output()).toContain('/byok probe agent model:openrouter/unverified');
        expect(ctx.output()).toContain('Use /byok models para explorar catalogo bruto');
    });

    it('distingue health de chat vindo de probe e de turno vivo no ranking BYOK', async () => {
        readByokProviderModelHealth.mockImplementation(({ model }) =>
            model === 'probe-ok'
                ? {
                      key: 'kilo|kilo-code|probe-ok',
                      profile: 'kilo',
                      provider: 'kilo-code',
                      model,
                      lastStatus: 'ok',
                      failureCount: 0,
                      successCount: 1,
                      lastFailureAt: null,
                      lastSuccessAt: Date.now(),
                      lastMessage: null,
                      lastErrorContext: null,
                      lastSuccessContext: 'byok_probe',
                      agentProbeStatus: null,
                      agentProbeFailureCount: 0,
                      agentProbeSuccessCount: 0,
                      lastAgentProbeFailureAt: null,
                      lastAgentProbeSuccessAt: null,
                      lastAgentProbeMessage: null,
                      lastAgentProbeErrorContext: null,
                  }
                : model === 'turn-ok'
                  ? {
                        key: 'kilo|kilo-code|turn-ok',
                        profile: 'kilo',
                        provider: 'kilo-code',
                        model,
                        lastStatus: 'ok',
                        failureCount: 0,
                        successCount: 1,
                        lastFailureAt: null,
                        lastSuccessAt: Date.now(),
                        lastMessage: null,
                        lastErrorContext: null,
                        lastSuccessContext: 'llm.usage',
                        agentProbeStatus: null,
                        agentProbeFailureCount: 0,
                        agentProbeSuccessCount: 0,
                        lastAgentProbeFailureAt: null,
                        lastAgentProbeSuccessAt: null,
                        lastAgentProbeMessage: null,
                        lastAgentProbeErrorContext: null,
                    }
                  : null,
        );
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'probe-ok',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: { freeTier: true, provider: 'kilo-code', profile: 'kilo' },
                },
                {
                    id: 'turn-ok',
                    capabilities: {
                        supports: { reasoningEffort: true, vision: false },
                        limits: { max_context_window_tokens: 200000 },
                    },
                    byok: { freeTier: true, provider: 'kilo-code', profile: 'kilo' },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning 2');

        expect(ctx.output()).toContain('chat=ok(probe,');
        expect(ctx.output()).toContain('chat=ok(turno,');
    });

    it('exclui de recommend safe modelo com falha operacional recente', async () => {
        const now = Date.now();
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'cerebras-free|cerebras|gpt-oss-120b',
                profile: 'cerebras-free',
                provider: 'cerebras',
                model: 'gpt-oss-120b',
                lastStatus: 'failed',
                failureCount: 3,
                successCount: 0,
                lastFailureAt: now,
                lastSuccessAt: null,
                lastMessage: 'Connection error',
                lastErrorContext: 'model_call',
            },
            {
                key: 'kilo|kilo-code|kilo/healthy',
                profile: 'kilo',
                provider: 'kilo-code',
                model: 'kilo/healthy',
                lastStatus: 'ok',
                failureCount: 0,
                successCount: 1,
                lastFailureAt: null,
                lastSuccessAt: now,
                lastMessage: null,
                lastErrorContext: null,
                agentProbeStatus: 'ok',
                agentProbeFailureCount: 0,
                agentProbeSuccessCount: 1,
                lastAgentProbeFailureAt: null,
                lastAgentProbeSuccessAt: now,
            },
        ]);
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'gpt-oss-120b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        provider: 'cerebras',
                        profile: 'cerebras-free',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'kilo/healthy',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'kilo-code',
                        profile: 'kilo',
                        rateLimits: { maxRequestTokens: 128000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://provider.example/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 5');

        expect(ctx.output()).toContain('kilo/healthy');
        expect(ctx.output()).not.toContain('gpt-oss-120b');
    });

    it('mostra falha operacional em models quando safe não foi solicitado', async () => {
        const now = Date.now();
        listByokProviderModelHealth.mockReturnValue([
            {
                key: 'cerebras-free|cerebras|gpt-oss-120b',
                profile: 'cerebras-free',
                provider: 'cerebras',
                model: 'gpt-oss-120b',
                lastStatus: 'failed',
                failureCount: 1,
                successCount: 0,
                lastFailureAt: now,
                lastSuccessAt: null,
                lastMessage: 'Connection error',
                lastErrorContext: 'model_call',
            },
        ]);
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'gpt-oss-120b',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        provider: 'cerebras',
                        profile: 'cerebras-free',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.cerebras.ai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'models free reasoning 5');

        expect(ctx.output()).toContain('gpt-oss-120b');
        expect(ctx.output()).toContain('chat=failed');
    });

    it('recomenda modelos BYOK filtrando provider e modelos medidos', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/free',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: true, provider: 'openrouter' },
                },
                {
                    id: 'openrouter/paid',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'openrouter' },
                },
                {
                    id: 'groq/paid',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 128000 } },
                    byok: { freeTier: false, provider: 'groq' },
                },
            ],
            source: 'remote',
            endpoint: 'https://openrouter.ai/api/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend provider:openrouter metered reasoning 5');

        expect(ctx.output()).toContain('filtros=provider:openrouter,metered,reasoning');
        expect(ctx.output()).toContain('openrouter/paid');
        expect(ctx.output()).not.toContain('openrouter/free');
        expect(ctx.output()).not.toContain('groq/paid');
    });

    it('recomenda modelos BYOK mostrando aviso quando o limite do provider é baixo', async () => {
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'groq-small-budget',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 131072 } },
                    byok: {
                        freeTier: true,
                        rateLimits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                        provider: 'groq',
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://api.groq.com/openai/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning');

        expect(ctx.output()).toContain('groq-small-budget');
        expect(ctx.output()).toContain('baixo para turno real');
        expect(ctx.output()).toContain('sessão fresca');
    });

    it('recomenda modelos BYOK considerando o orçamento vivo da sessão atual', async () => {
        const now = Date.now();
        readByokProviderModelHealth.mockImplementation(({ model }) =>
            model === 'openrouter-roomy'
                ? {
                      key: 'openrouter|openrouter|openrouter-roomy',
                      profile: null,
                      provider: 'openrouter',
                      model,
                      lastStatus: 'ok',
                      failureCount: 0,
                      successCount: 1,
                      lastFailureAt: null,
                      lastSuccessAt: now,
                      lastMessage: null,
                      lastErrorContext: null,
                      agentProbeStatus: 'ok',
                      agentProbeFailureCount: 0,
                      agentProbeSuccessCount: 1,
                      lastAgentProbeFailureAt: null,
                      lastAgentProbeSuccessAt: now,
                  }
                : null,
        );
        readTerminalRuntimeState.mockReturnValue({
            contextWindow: { tokens: 63000, tokenLimit: 200000, utilization: 0.315 },
        });
        discoverConfiguredByokModelsFromEnv.mockResolvedValue({
            models: [
                {
                    id: 'openrouter/almost-enough',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 64000 },
                    },
                },
                {
                    id: 'openrouter-roomy',
                    capabilities: { supports: { reasoningEffort: true, vision: false }, limits: { max_context_window_tokens: 200000 } },
                    byok: {
                        freeTier: true,
                        provider: 'openrouter',
                        rateLimits: { maxRequestTokens: 128000 },
                    },
                },
            ],
            source: 'remote',
            endpoint: 'https://openrouter.ai/api/v1/models',
            fromCache: false,
            error: null,
        });
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'recommend free reasoning safe 5');

        expect(ctx.output()).toContain('contexto atual≈63000/200000 tokens');
        expect(ctx.output()).toContain('estimativa pré-turno≈64024 tokens');
        expect(ctx.output()).toContain('openrouter-roomy');
        expect(ctx.output()).not.toContain('openrouter/almost-enough');
        expect(ctx.output()).toContain('/byok probe agent model:openrouter-roomy');
    });

    it('recarrega .env.local sem imprimir segredos', async () => {
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_PROVIDER_PRESET'] = 'stale-provider';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        loadDotenv.mockReturnValue({ parsed: { KILO_API_KEY: 'secret' } });
        mockProjection({
            summary: {
                enabled: true,
                ready: true,
                profile: 'kilo',
                preset: 'kilo-code',
                providerType: 'openai',
                baseUrl: 'https://api.kilo.ai/api/gateway',
                model: 'anthropic/claude-sonnet-4.5',
                auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
            },
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'reload');

        expect(loadDotenv).toHaveBeenCalledWith({ path: '.env.local', override: true, quiet: true });
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('.env.local recarregado');
        expect(ctx.output()).toContain('BYOK status');
        expect(ctx.output()).not.toContain('secret');
    });

    it('troca provider efemero no processo atual', async () => {
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'provider kilo-code anthropic/claude-sonnet-4.5 https://api.kilo.ai/api/gateway');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBe('kilo-code');
        expect(process.env['COPILOT_BYOK_MODEL']).toBe('anthropic/claude-sonnet-4.5');
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBe('https://api.kilo.ai/api/gateway');
        expect(ctx.output()).toContain('BYOK status');
    });

    it('troca provider efemero limpando modelo e baseUrl antigos quando omitidos', async () => {
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        process.env['COPILOT_BYOK_MODEL'] = 'stale-model';
        process.env['COPILOT_BYOK_BASE_URL'] = 'https://stale.example/v1';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'provider openrouter');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_PROVIDER_PRESET']).toBe('openrouter');
        expect(process.env['COPILOT_BYOK_MODEL']).toBeUndefined();
        expect(process.env['COPILOT_BYOK_BASE_URL']).toBeUndefined();
        expect(ctx.output()).toContain('BYOK status');
    });

    it('persiste perfil BYOK em .env.local sem gravar segredo novo', async () => {
        readFile.mockResolvedValue(
            [
                'COPILOT_BYOK_ENABLED=false',
                'COPILOT_BYOK_PROFILE=old',
                'COPILOT_BYOK_MODEL=old-model',
                'COPILOT_BYOK_PROVIDER_PRESET=old-provider',
                'KILO_CODE_API_KEY=existing-secret',
                '',
            ].join('\n'),
        );
        mockProjection({
            profiles: [
                {
                    name: 'kilo',
                    preset: 'kilo-code',
                    providerType: 'openai',
                    baseUrl: 'https://api.kilo.ai/api/gateway',
                    model: 'kilo-auto/free',
                    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
                    metadataKeys: [],
                },
            ],
        });
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'persist profile kilo');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('true');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBe('kilo');
        expect(writeFile).toHaveBeenCalledWith(
            expect.stringMatching(/^\.env\.local\.tmp-/),
            expect.stringContaining('COPILOT_BYOK_PROFILE=kilo'),
            expect.objectContaining({ mode: 0o600 }),
        );
        const written = String(writeFile.mock.calls[0][1]);
        expect(written).toContain('COPILOT_BYOK_ENABLED=true');
        expect(written).not.toContain('COPILOT_BYOK_MODEL=old-model');
        expect(written).toContain('KILO_CODE_API_KEY=existing-secret');
        expect(rename).toHaveBeenCalledWith(expect.stringMatching(/^\.env\.local\.tmp-/), '.env.local');
        expect(ctx.output()).toContain('Perfil BYOK persistido: kilo');
        expect(ctx.output()).not.toContain('existing-secret');
    });

    it('persiste volta ao SDK removendo seletores BYOK conflitantes', async () => {
        readFile.mockResolvedValue(
            [
                'COPILOT_BYOK_ENABLED=true',
                'COPILOT_BYOK_PROFILE=kilo',
                'COPILOT_BYOK_MODEL=kilo-auto/free',
                'COPILOT_BYOK_PROVIDER_PRESET=kilo-code',
                'COPILOT_BYOK_BASE_URL=https://api.kilo.ai/api/gateway',
                '',
            ].join('\n'),
        );
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'persist sdk');

        const written = String(writeFile.mock.calls[0][1]);
        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('false');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
        expect(written).toContain('COPILOT_BYOK_ENABLED=false');
        expect(written).not.toContain('COPILOT_BYOK_PROFILE=');
        expect(written).not.toContain('COPILOT_BYOK_MODEL=');
        expect(written).not.toContain('COPILOT_BYOK_PROVIDER_PRESET=');
        expect(ctx.output()).toContain('SDK Copilot governará o próximo boot');
    });
});
