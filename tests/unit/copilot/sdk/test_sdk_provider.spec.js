// @ts-check
import { describe, expect, it, vi } from 'vitest';

// ─── SDK mock ──────────────────────────────────────────────────────────────

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return { SYSTEM_PROMPT_SECTIONS };
});

// ─── Imports ───────────────────────────────────────────────────────────────

import {
    anthropicProvider,
    azureProvider,
    buildConfiguredByokModelListHandler,
    discoverConfiguredByokModelsFromEnv,
    isValidProviderType,
    openaiProvider,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokProfileSummaries,
    readConfiguredByokProfilesFromEnv,
    readConfiguredByokState,
    readConfiguredByokSummary,
    redactProviderConfig,
    resolveConfiguredByokSessionOverrides,
    validateProviderConfig,
} from '#copilot/sdk/session';

// ═════════════════════════════════════════════════════════════════════════════
// F67 — openaiProvider
// ═════════════════════════════════════════════════════════════════════════════

describe('F67 — openaiProvider', () => {
    it('cria config OpenAI com baseUrl e apiKey', () => {
        const config = openaiProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-123' });
        expect(config.type).toBe('openai');
        expect(config.baseUrl).toBe('https://api.openai.com/v1');
        expect(config.apiKey).toBe('sk-123');
    });

    it('cria config sem apiKey (Ollama local)', () => {
        const config = openaiProvider({ baseUrl: 'http://localhost:11434/v1' });
        expect(config.type).toBe('openai');
        expect(config.baseUrl).toBe('http://localhost:11434/v1');
        expect(config.apiKey).toBeUndefined();
    });

    it('aceita bearerToken', () => {
        const config = openaiProvider({ baseUrl: 'https://api.example.com', bearerToken: 'token-xyz' });
        expect(config.bearerToken).toBe('token-xyz');
    });

    it('aceita wireApi: responses', () => {
        const config = openaiProvider({ baseUrl: 'https://api.openai.com/v1', wireApi: 'responses' });
        expect(config.wireApi).toBe('responses');
    });

    it('aceita headers adicionais', () => {
        const config = openaiProvider({
            baseUrl: 'https://api.openai.com/v1',
            headers: { 'x-test': 'enabled' },
        });
        expect(config.headers).toEqual({ 'x-test': 'enabled' });
    });

    it('lanca erro se baseUrl esta vazio', () => {
        expect(() => openaiProvider({ baseUrl: '' })).toThrow('baseUrl is required');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F68 — azureProvider
// ═════════════════════════════════════════════════════════════════════════════

describe('F68 — azureProvider', () => {
    it('cria config Azure com baseUrl e apiKey', () => {
        const config = azureProvider({ baseUrl: 'https://my-resource.openai.azure.com', apiKey: 'azure-key' });
        expect(config.type).toBe('azure');
        expect(config.baseUrl).toBe('https://my-resource.openai.azure.com');
        expect(config.apiKey).toBe('azure-key');
    });

    it('inclui apiVersion no campo azure', () => {
        const config = azureProvider({ baseUrl: 'https://x.azure.com', apiVersion: '2024-10-21' });
        expect(config.azure).toEqual({ apiVersion: '2024-10-21' });
    });

    it('nao inclui campo azure quando apiVersion nao e fornecido', () => {
        const config = azureProvider({ baseUrl: 'https://x.azure.com' });
        expect(config.azure).toBeUndefined();
    });

    it('aceita wireApi', () => {
        const config = azureProvider({ baseUrl: 'https://x.azure.com', wireApi: 'completions' });
        expect(config.wireApi).toBe('completions');
    });

    it('preserva headers adicionais', () => {
        const config = azureProvider({ baseUrl: 'https://x.azure.com', headers: { 'api-key': 'abc' } });
        expect(config.headers).toEqual({ 'api-key': 'abc' });
    });

    it('lanca erro se baseUrl esta vazio', () => {
        expect(() => azureProvider({ baseUrl: '' })).toThrow('baseUrl is required');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F69 — anthropicProvider
// ═════════════════════════════════════════════════════════════════════════════

describe('F69 — anthropicProvider', () => {
    it('cria config Anthropic com baseUrl e apiKey', () => {
        const config = anthropicProvider({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-123' });
        expect(config.type).toBe('anthropic');
        expect(config.baseUrl).toBe('https://api.anthropic.com');
        expect(config.apiKey).toBe('sk-ant-123');
    });

    it('aceita bearerToken', () => {
        const config = anthropicProvider({ baseUrl: 'https://api.anthropic.com', bearerToken: 'tok' });
        expect(config.bearerToken).toBe('tok');
    });

    it('aceita headers adicionais', () => {
        const config = anthropicProvider({
            baseUrl: 'https://api.anthropic.com',
            headers: { 'anthropic-version': '2023-06-01' },
        });
        expect(config.headers).toEqual({ 'anthropic-version': '2023-06-01' });
    });

    it('nao inclui wireApi (anthropic nao usa)', () => {
        const config = anthropicProvider({ baseUrl: 'https://api.anthropic.com' });
        expect(config.wireApi).toBeUndefined();
    });

    it('rejeita wireApi para anthropic', () => {
        expect(() =>
            validateProviderConfig({
                baseUrl: 'https://api.anthropic.com',
                type: 'anthropic',
                wireApi: /** @type {any} */ ('responses'),
            }),
        ).toThrow('wireApi is not supported for anthropic');
    });

    it('lanca erro se baseUrl esta vazio', () => {
        expect(() => anthropicProvider({ baseUrl: '' })).toThrow('baseUrl is required');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F70 — validateProviderConfig
// ═════════════════════════════════════════════════════════════════════════════

describe('F70 — validateProviderConfig', () => {
    it('valida config valido sem tipo (default openai)', () => {
        const config = validateProviderConfig({ baseUrl: 'http://localhost:8080' });
        expect(config.baseUrl).toBe('http://localhost:8080');
        expect(config.type).toBe('openai');
    });

    it('lanca erro se config e null', () => {
        expect(() => validateProviderConfig(/** @type {any} */ (null))).toThrow('config must be a non-null object');
    });

    it('lanca erro se baseUrl ausente', () => {
        expect(() => validateProviderConfig(/** @type {any} */ ({}))).toThrow('baseUrl is required');
    });

    it('lanca erro se type invalido', () => {
        expect(() => validateProviderConfig({ baseUrl: 'http://x', type: /** @type {any} */ ('gemini') })).toThrow(
            "invalid provider type: 'gemini'",
        );
    });

    it('lanca erro se wireApi invalido', () => {
        expect(() =>
            validateProviderConfig({ baseUrl: 'http://x', wireApi: /** @type {any} */ ('streaming') }),
        ).toThrow("invalid wireApi: 'streaming'");
    });

    it('aceita todos os 3 provider types validos', () => {
        expect(validateProviderConfig({ baseUrl: 'http://x', type: 'openai' }).type).toBe('openai');
        expect(validateProviderConfig({ baseUrl: 'http://x', type: 'azure' }).type).toBe('azure');
        expect(validateProviderConfig({ baseUrl: 'http://x', type: 'anthropic' }).type).toBe('anthropic');
    });

    it('aceita wireApi completions e responses', () => {
        expect(validateProviderConfig({ baseUrl: 'http://x', wireApi: 'completions' }).wireApi).toBe('completions');
        expect(validateProviderConfig({ baseUrl: 'http://x', wireApi: 'responses' }).wireApi).toBe('responses');
    });

    it('lanca erro para headers invalidos', () => {
        expect(() => validateProviderConfig({ baseUrl: 'http://x', headers: /** @type {any} */ ([]) })).toThrow(
            'headers must be a plain object',
        );
    });

    it('lanca erro para apiKey vazia', () => {
        expect(() => validateProviderConfig({ baseUrl: 'http://x', apiKey: '   ' })).toThrow(
            'apiKey must be a non-empty string',
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F70b — isValidProviderType
// ═════════════════════════════════════════════════════════════════════════════

describe('F70b — isValidProviderType', () => {
    it('retorna true para tipos validos', () => {
        expect(isValidProviderType('openai')).toBe(true);
        expect(isValidProviderType('azure')).toBe(true);
        expect(isValidProviderType('anthropic')).toBe(true);
    });

    it('retorna false para tipos invalidos', () => {
        expect(isValidProviderType('gemini')).toBe(false);
        expect(isValidProviderType('')).toBe(false);
        expect(isValidProviderType('Openai')).toBe(false);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F71 — Barrel re-exports
// ═════════════════════════════════════════════════════════════════════════════

describe('F71 — Barrel re-exports (sdk/index.js)', () => {
    it('re-exporta as 5 funcoes do provider.js', async () => {
        const barrel = await import('#copilot/sdk');

        expect(barrel.openaiProvider).toBeTypeOf('function');
        expect(barrel.azureProvider).toBeTypeOf('function');
        expect(barrel.anthropicProvider).toBeTypeOf('function');
        expect(barrel.validateProviderConfig).toBeTypeOf('function');
        expect(barrel.isValidProviderType).toBeTypeOf('function');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F72 — BYOK env configuration
// ═════════════════════════════════════════════════════════════════════════════

describe('F72 — BYOK env configuration', () => {
    it('fica desabilitado sem intenção explícita de BYOK', () => {
        const state = readConfiguredByokState({});
        expect(state.enabled).toBe(false);
        expect(state.summary.ready).toBe(false);
    });

    it('monta provider Ollama local OpenAI-compatible sem segredo', () => {
        const state = readConfiguredByokState({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'ollama-local',
            COPILOT_BYOK_MODEL: 'qwen2.5-coder',
            OLLAMA_LOCAL_BASE_URL: 'http://localhost:11434',
        });

        expect(state.ready).toBe(true);
        expect(state.provider).toMatchObject({
            type: 'openai',
            baseUrl: 'http://localhost:11434/v1',
        });
        expect(state.provider?.apiKey).toBeUndefined();
        expect(state.model).toBe('qwen2.5-coder');
    });

    it('exige modelo explícito para BYOK', () => {
        const state = readConfiguredByokState({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openai',
            COPILOT_BYOK_API_KEY: 'secret',
        });

        expect(state.ready).toBe(false);
        expect(state.summary.errors.join('\n')).toContain('COPILOT_BYOK_MODEL');
    });

    it('redige apiKey, bearerToken e headers', () => {
        const redacted = redactProviderConfig({
            type: 'openai',
            baseUrl: 'https://api.example.test/v1',
            apiKey: 'secret',
            bearerToken: 'token',
            headers: { 'x-private': 'value' },
        });

        expect(redacted).toEqual({
            type: 'openai',
            baseUrl: 'https://api.example.test/v1',
            apiKey: '[redacted]',
            bearerToken: '[redacted]',
            headers: { 'x-private': '[redacted]' },
        });
    });

    it('resolve overrides de sessão com modelCapabilities e provider', () => {
        const overrides = resolveConfiguredByokSessionOverrides(
            {
                COPILOT_BYOK_ENABLED: 'true',
                COPILOT_BYOK_PROVIDER_PRESET: 'openai-compatible',
                COPILOT_BYOK_BASE_URL: 'https://provider.example/v1',
                COPILOT_BYOK_MODEL: 'provider-model',
                COPILOT_BYOK_SUPPORTS_REASONING: 'true',
                COPILOT_BYOK_CONTEXT_WINDOW_TOKENS: '64000',
            },
            'auto',
        );

        expect(overrides.enabled).toBe(true);
        expect(overrides.model).toBe('provider-model');
        expect(overrides.provider).toMatchObject({ type: 'openai', baseUrl: 'https://provider.example/v1' });
        expect(overrides.modelCapabilities?.supports?.reasoningEffort).toBe(true);
        expect(overrides.modelCapabilities?.limits?.max_context_window_tokens).toBe(64000);
    });

    it('omite reasoningEffort SDK para IDs BYOK provider-literais com dois-pontos preservando metadata semântica', () => {
        const overrides = resolveConfiguredByokSessionOverrides(
            {
                COPILOT_BYOK_ENABLED: 'true',
                COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
                COPILOT_BYOK_MODEL: 'deepseek/deepseek-v4-flash:free',
                COPILOT_BYOK_API_KEY: 'unit-token',
                COPILOT_BYOK_SUPPORTS_REASONING: 'true',
            },
            'auto',
        );

        expect(overrides.enabled).toBe(true);
        expect(overrides.model).toBe('deepseek/deepseek-v4-flash:free');
        expect(overrides.summary.capabilities.reasoningEffort).toBe(true);
        expect(overrides.summary.capabilities.sdkReasoningEffort).toBe(false);
        expect(overrides.supportsReasoning).toBe(false);
        expect(overrides.modelCapabilities?.supports?.reasoningEffort).toBe(false);
        expect(overrides.summary.warnings.join('\n')).toContain("ID contem ':'");
    });

    it('mantém filtro semântico de reasoning em catálogo BYOK mesmo quando sdkReasoningEffort é omitido', () => {
        const models = readConfiguredByokModelsFromEnv({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
            COPILOT_BYOK_API_KEY: 'unit-token',
            COPILOT_BYOK_MODEL: 'deepseek/deepseek-v4-flash:free',
            COPILOT_BYOK_MODELS: 'deepseek/deepseek-v4-flash:free',
            COPILOT_BYOK_SUPPORTS_REASONING: 'true',
        });

        expect(models[0]?.id).toBe('deepseek/deepseek-v4-flash:free');
        expect(models[0]?.capabilities.supports.reasoningEffort).toBe(false);
        expect(/** @type {{ byok?: { supportsReasoning?: boolean } }} */ (models[0]).byok?.supportsReasoning).toBe(true);
    });

    it('fornece onListModels com fallback estático para client.listModels em BYOK', async () => {
        const handler = buildConfiguredByokModelListHandler({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_BASE_URL: 'https://provider.example/v1',
            COPILOT_BYOK_MODEL: 'a',
            COPILOT_BYOK_MODELS: 'a,b',
            COPILOT_BYOK_MODEL_DISCOVERY_ENABLED: 'false',
        });

        expect(handler).toBeTypeOf('function');
        const models = await handler?.();
        expect(models?.map((model) => model.id)).toEqual(['a', 'b']);
    });

    it('descobre modelos remotos OpenAI-compatible com timeout/cache e sem vazar segredo', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'remote-a' }, { id: 'remote-b' }, { id: 'remote-a' }] }),
        }));
        vi.stubGlobal('fetch', fetchMock);
        try {
            const env = {
                COPILOT_BYOK_ENABLED: 'true',
                COPILOT_BYOK_BASE_URL: 'https://provider.example/v1',
                COPILOT_BYOK_MODEL: 'fallback-model',
                COPILOT_BYOK_BEARER_TOKEN: 'unit-token',
            };

            const first = await discoverConfiguredByokModelsFromEnv(env, { forceRefresh: true });
            const second = await discoverConfiguredByokModelsFromEnv(env);

            expect(first.source).toBe('remote');
            expect(first.endpoint).toBe('https://provider.example/v1/models');
            expect(first.models.map((model) => model.id)).toEqual(['remote-a', 'remote-b']);
            expect(first.configuredModel).toEqual({
                id: 'fallback-model',
                inCatalog: false,
                authoritative: true,
            });
            expect(second.source).toBe('remote-cache');
            expect(second.configuredModel).toEqual({
                id: 'fallback-model',
                inCatalog: false,
                authoritative: true,
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer unit-token' });
            expect(JSON.stringify(first)).not.toContain('unit-token');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('faz fallback estático quando descoberta remota falha', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: false,
                status: 503,
                json: async () => ({}),
            })),
        );
        try {
            const result = await discoverConfiguredByokModelsFromEnv(
                {
                    COPILOT_BYOK_ENABLED: 'true',
                    COPILOT_BYOK_BASE_URL: 'https://provider.example/v1',
                    COPILOT_BYOK_MODEL: 'fallback-model',
                    COPILOT_BYOK_MODELS: 'fallback-model,static-b',
                },
                { forceRefresh: true },
            );

            expect(result.source).toBe('static-fallback');
            expect(result.models.map((model) => model.id)).toEqual(['fallback-model', 'static-b']);
            expect(result.error).toContain('HTTP 503');
            expect(result.configuredModel).toEqual({
                id: 'fallback-model',
                inCatalog: null,
                authoritative: false,
            });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('summary seguro mostra apenas presença de auth', () => {
        const summary = readConfiguredByokSummary({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'ollama-cloud',
            COPILOT_BYOK_MODEL: 'qwen3-coder-next',
            OLLAMA_CLOUD_API_KEY: 'secret',
        });

        expect(summary.ready).toBe(true);
        expect(summary.auth.apiKeyConfigured).toBe(true);
        expect(JSON.stringify(summary)).not.toContain('secret');
    });

    it('resolve preset Kilo Gateway como OpenAI-compatible com bearer token', () => {
        const state = readConfiguredByokState({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'kilo-code',
            COPILOT_BYOK_MODEL: 'anthropic/claude-sonnet-4.5',
            KILO_API_KEY: 'kilo-secret',
        });

        expect(state.ready).toBe(true);
        expect(state.provider).toMatchObject({
            type: 'openai',
            baseUrl: 'https://api.kilo.ai/api/gateway',
            bearerToken: 'kilo-secret',
        });
        expect(state.summary.auth.bearerTokenConfigured).toBe(true);
        expect(JSON.stringify(state.summary)).not.toContain('kilo-secret');
    });

    it('resolve presets BYOK universais com endpoints oficiais e auth seguro', () => {
        const cases = [
            {
                preset: 'openrouter',
                secretKey: 'OPENROUTER_API_KEY',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'openrouter/free',
            },
            {
                preset: 'groq',
                secretKey: 'GROQ_API_KEY',
                baseUrl: 'https://api.groq.com/openai/v1',
                model: 'qwen/qwen3-32b',
            },
            {
                preset: 'gemini',
                secretKey: 'GEMINI_API_KEY',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                model: 'gemini-2.5-flash',
            },
            {
                preset: 'cerebras',
                secretKey: 'CEREBRAS_API_KEY',
                baseUrl: 'https://api.cerebras.ai/v1',
                model: 'gpt-oss-120b',
            },
            {
                preset: 'cloudflare-workers-ai',
                secretKey: 'CLOUDFLARE_API_TOKEN',
                baseUrl: 'https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1',
                model: '@cf/meta/llama-3.1-8b-instruct',
                extraEnv: { CLOUDFLARE_ACCOUNT_ID: 'account-1' },
            },
        ];

        for (const item of cases) {
            const state = readConfiguredByokState({
                COPILOT_BYOK_ENABLED: 'true',
                COPILOT_BYOK_PROVIDER_PRESET: item.preset,
                [item.secretKey]: 'provider-secret',
                ...(item.extraEnv ?? {}),
            });

            expect(state.ready, item.preset).toBe(true);
            expect(state.provider).toMatchObject({ type: 'openai', baseUrl: item.baseUrl });
            expect(state.model).toBe(item.model);
            expect(JSON.stringify(state.summary)).not.toContain('provider-secret');
        }
    });

    it('preserva metadata rica de modelos BYOK estaticos e remotos', async () => {
        const staticModels = readConfiguredByokModelsFromEnv({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
            COPILOT_BYOK_MODELS_JSON: JSON.stringify([
                {
                    id: 'meta/model:free',
                    name: 'Meta Free',
                    context_length: 65536,
                    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
                    pricing: { prompt: '0', completion: '0' },
                    supported_parameters: ['tools', 'reasoning'],
                },
            ]),
        });

        expect(staticModels[0]?.id).toBe('meta/model:free');
        expect(staticModels[0]?.capabilities.supports.vision).toBe(true);
        expect(staticModels[0]?.capabilities.supports.reasoningEffort).toBe(false);
        expect(/** @type {{ byok?: { supportsReasoning?: boolean } }} */ (staticModels[0]).byok?.supportsReasoning).toBe(true);
        expect(staticModels[0]?.capabilities.limits.max_context_window_tokens).toBe(65536);
        expect(staticModels[0]?.policy?.terms).toContain('byok:free');

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    data: [
                        {
                            id: 'remote/reasoner:free',
                            context_length: 131072,
                            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
                            pricing: { prompt: '0', completion: '0' },
                            supported_parameters: ['reasoning'],
                        },
                    ],
                }),
            })),
        );
        try {
            const remote = await discoverConfiguredByokModelsFromEnv(
                {
                    COPILOT_BYOK_ENABLED: 'true',
                    COPILOT_BYOK_PROVIDER_PRESET: 'openrouter',
                    OPENROUTER_API_KEY: 'secret',
                },
                { forceRefresh: true },
            );

            expect(remote.source).toBe('remote');
            expect(remote.models[0]?.id).toBe('remote/reasoner:free');
            expect(remote.models[0]?.policy?.terms).toContain('byok:free');
            expect(remote.models[0]?.capabilities.supports.reasoningEffort).toBe(false);
            expect(/** @type {{ byok?: { supportsReasoning?: boolean } }} */ (remote.models[0]).byok?.supportsReasoning).toBe(true);
            expect(remote.models[0]?.capabilities.limits.max_context_window_tokens).toBe(131072);
            expect(JSON.stringify(remote)).not.toContain('secret');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('nao herda capabilities de provider em catalogo remoto sem evidencia por modelo', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    data: [{ id: 'plain-chat-model', owned_by: 'provider-x', context_length: 8192 }],
                }),
            })),
        );
        try {
            const remote = await discoverConfiguredByokModelsFromEnv(
                {
                    COPILOT_BYOK_ENABLED: 'true',
                    COPILOT_BYOK_PROVIDER_PRESET: 'groq',
                    GROQ_API_KEY: 'secret',
                    COPILOT_BYOK_SUPPORTS_REASONING: 'true',
                    COPILOT_BYOK_SUPPORTS_VISION: 'true',
                },
                { forceRefresh: true },
            );

            expect(remote.models[0]?.capabilities.supports.reasoningEffort).toBe(false);
            expect(remote.models[0]?.capabilities.supports.vision).toBe(false);
            expect(remote.models[0]?.byok?.provider).toBe('provider-x');
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('propaga limites BYOK de profile para summary e modelos', () => {
        const state = readConfiguredByokState({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'groq',
            COPILOT_BYOK_MODEL: 'qwen/qwen3-32b',
            GROQ_API_KEY: 'secret',
            COPILOT_BYOK_MAX_REQUEST_TOKENS: '6000',
            COPILOT_BYOK_TOKENS_PER_MINUTE: '6000',
            COPILOT_BYOK_REQUESTS_PER_MINUTE: '30',
        });
        const models = readConfiguredByokModelsFromEnv({
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROVIDER_PRESET: 'groq',
            COPILOT_BYOK_MODEL: 'qwen/qwen3-32b',
            COPILOT_BYOK_MAX_REQUEST_TOKENS: '6000',
            COPILOT_BYOK_TOKENS_PER_MINUTE: '6000',
            COPILOT_BYOK_REQUESTS_PER_MINUTE: '30',
        });

        expect(state.summary.limits).toMatchObject({ maxRequestTokens: 6000, tokensPerMinute: 6000, requestsPerMinute: 30 });
        expect(models[0]?.byok?.rateLimits).toMatchObject({ maxRequestTokens: 6000, tokensPerMinute: 6000, requestsPerMinute: 30 });
    });

    it('resolve perfil ativo a partir de COPILOT_BYOK_PROFILES_JSON sem vazar segredo', () => {
        const profilesJson = JSON.stringify({
            kilo: {
                preset: 'kilo-code',
                model: 'anthropic/claude-sonnet-4.5',
                bearerTokenEnv: 'KILO_API_KEY',
                metadata: { owner: 'terminal-llm-b' },
            },
        });
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROFILE: 'kilo',
            COPILOT_BYOK_PROFILES_JSON: profilesJson,
            KILO_API_KEY: 'kilo-secret',
        };

        const state = readConfiguredByokState(env);
        const profiles = readConfiguredByokProfileSummaries(env);

        expect(readConfiguredByokProfilesFromEnv(env).kilo).toBeTruthy();
        expect(state.ready).toBe(true);
        expect(state.summary.profile).toBe('kilo');
        expect(state.model).toBe('anthropic/claude-sonnet-4.5');
        expect(state.provider?.bearerToken).toBe('kilo-secret');
        expect(profiles[0]).toMatchObject({
            name: 'kilo',
            preset: 'kilo-code',
            model: 'anthropic/claude-sonnet-4.5',
            auth: { bearerTokenConfigured: true },
            metadataKeys: ['owner'],
        });
        expect(JSON.stringify(state.summary)).not.toContain('kilo-secret');
        expect(JSON.stringify(profiles)).not.toContain('kilo-secret');
    });

    it('permite override transiente de modelo mantendo provider e credenciais do perfil ativo', () => {
        const profilesJson = JSON.stringify({
            local: {
                preset: 'openai-compatible',
                baseUrl: 'http://127.0.0.1:11434/v1',
                model: 'fixture/model-a',
                bearerToken: 'fixture-secret',
                models: 'fixture/model-a,fixture/model-b',
            },
        });
        const env = {
            COPILOT_BYOK_ENABLED: 'true',
            COPILOT_BYOK_PROFILE: 'local',
            COPILOT_BYOK_PROFILES_JSON: profilesJson,
            COPILOT_BYOK_MODEL: 'fixture/model-b',
        };

        const state = readConfiguredByokState(env);
        const models = buildConfiguredByokModelListHandler(env);

        expect(state.ready).toBe(true);
        expect(state.summary.profile).toBe('local');
        expect(state.model).toBe('fixture/model-b');
        expect(state.provider).toMatchObject({
            type: 'openai',
            baseUrl: 'http://127.0.0.1:11434/v1',
            bearerToken: 'fixture-secret',
        });
        expect(models).toBeDefined();
    });
});
