// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

const { chmod, discoverConfiguredByokModelsFromEnv, loadDotenv, readFile, readTerminalByokProjection, rename, writeFile } =
    vi.hoisted(() => ({
        chmod: vi.fn(),
        discoverConfiguredByokModelsFromEnv: vi.fn(),
        loadDotenv: vi.fn(),
        readFile: vi.fn(),
        readTerminalByokProjection: vi.fn(),
        rename: vi.fn(),
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
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalByokProjection,
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
        loadDotenv.mockReset();
        readFile.mockReset();
        readTerminalByokProjection.mockReset();
        rename.mockReset();
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
        expect(ctx.output()).not.toContain('secret');
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

    it('recomenda modelos BYOK com filtros e alerta limites baixos', async () => {
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
