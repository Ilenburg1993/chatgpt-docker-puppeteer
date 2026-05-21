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
        delete process.env['COPILOT_BYOK_MODEL'];
        delete process.env['COPILOT_BYOK_BASE_URL'];
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
        expect(ctx.output()).toContain('BYOK status');
    });

    it('desativa BYOK e volta para SDK', async () => {
        process.env['COPILOT_BYOK_ENABLED'] = 'true';
        process.env['COPILOT_BYOK_PROFILE'] = 'kilo';
        mockProjection();
        const ctx = mockCtx();

        await cmdByok({ println: ctx.println }, 'use sdk');

        expect(process.env['COPILOT_BYOK_ENABLED']).toBe('false');
        expect(process.env['COPILOT_BYOK_PROFILE']).toBeUndefined();
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
        expect(ctx.output()).toContain('ctx=200000');
    });

    it('recarrega .env.local sem imprimir segredos', async () => {
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
        expect(ctx.output()).toContain('.env.local recarregado');
        expect(ctx.output()).toContain('BYOK status');
        expect(ctx.output()).not.toContain('secret');
    });

    it('troca provider efemero no processo atual', async () => {
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
