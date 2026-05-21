// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

const readTerminalByokProjection = vi.fn();

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
        readTerminalByokProjection.mockReset();
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
});
