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
    isValidProviderType,
    openaiProvider,
    validateProviderConfig,
} from '#copilot/sdk/provider.js';

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

    it('nao inclui wireApi (anthropic nao usa)', () => {
        const config = anthropicProvider({ baseUrl: 'https://api.anthropic.com' });
        expect(config.wireApi).toBeUndefined();
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
        const barrel = await import('#copilot/sdk/index.js');

        expect(barrel.openaiProvider).toBeTypeOf('function');
        expect(barrel.azureProvider).toBeTypeOf('function');
        expect(barrel.anthropicProvider).toBeTypeOf('function');
        expect(barrel.validateProviderConfig).toBeTypeOf('function');
        expect(barrel.isValidProviderType).toBeTypeOf('function');
    });
});
