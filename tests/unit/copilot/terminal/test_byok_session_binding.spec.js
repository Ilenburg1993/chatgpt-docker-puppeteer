// @ts-check

import { describe, expect, it } from 'vitest';

import {
    classifyTerminalByokSdkBinding,
    renderTerminalPreparedByokSelection,
    renderTerminalSdkProviderBinding,
} from '../../../../src/copilot/terminal/byok/session-binding.js';

const READY_KILO_SUMMARY = Object.freeze({
    enabled: true,
    ready: true,
    profile: 'kilo',
    preset: 'kilo-code',
    providerType: 'openai',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    model: 'kilo-auto/free',
    wireApi: 'completions',
    azureApiVersion: null,
    auth: { apiKeyConfigured: false, bearerTokenConfigured: true, headersConfigured: false },
    modelList: { configured: true, count: 3 },
    capabilities: { reasoningEffort: true, sdkReasoningEffort: true, vision: true, contextWindowTokens: 200_000 },
    limits: { maxRequestTokens: null, tokensPerMinute: null, requestsPerMinute: null, dailyRequests: null },
    warnings: [],
    errors: [],
});

const KILO_BINDING = Object.freeze({
    enabled: true,
    profile: 'kilo',
    preset: 'kilo-code',
    providerType: 'openai',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    model: 'anthropic/claude-sonnet-4.5',
});

describe('terminal/byok/session-binding', () => {
    it('renderiza seleção preparada e vínculo SDK sem expor termos internos', () => {
        expect(renderTerminalPreparedByokSelection(READY_KILO_SUMMARY)).toBe(
            'BYOK · perfil kilo · preset kilo-code · provedor openai · modelo kilo-auto/free',
        );
        expect(renderTerminalSdkProviderBinding(KILO_BINDING)).toBe(
            'BYOK · perfil kilo · preset kilo-code · provedor openai · modelo anthropic/claude-sonnet-4.5',
        );
    });

    it('humaniza divergência de modelo na mesma fronteira BYOK', () => {
        const result = classifyTerminalByokSdkBinding(READY_KILO_SUMMARY, KILO_BINDING, 'sdk-current');

        expect(result.state).toBe('live-model-drift');
        expect(result.sameProviderBoundary).toBe(true);
        expect(result.headline).toBe(
            'rota BYOK da sessão atual coincide; o modelo preparado ainda precisa de confirmação',
        );
        expect(result.action).toBe(
            '/byok model <id> pede a troca na sessão atual; confirme pelo próximo uso registrado ou por evento de modelo confirmado',
        );
        expect(result.headline).not.toMatch(/\bprovider\b|\bbinding\b|vivo coincide/u);
        expect(result.action).not.toMatch(/\bbinding\b/u);
    });

    it('trata modelo runtime confirmado como alinhado mesmo quando a sessão nasceu com outro modelo', () => {
        const result = classifyTerminalByokSdkBinding(
            READY_KILO_SUMMARY,
            KILO_BINDING,
            'sdk-current',
            'kilo-auto/free',
        );

        expect(result.state).toBe('live-model-confirmed');
        expect(result.sameProviderBoundary).toBe(true);
        expect(result.headline).toBe('modelo preparado confirmado no runtime vivo e preservado na sessão atual');
        expect(result.action).toBe(null);
        expect(result.headline).not.toMatch(/\bbinding\b|provider-boundary|precisa de confirmação/u);
    });

    it('humaniza cruzamento de provedor ou perfil sem vazar binding técnico', () => {
        const result = classifyTerminalByokSdkBinding(
            READY_KILO_SUMMARY,
            {
                enabled: true,
                profile: 'openrouter-free',
                preset: 'openrouter',
                providerType: 'openai',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'openrouter/free',
            },
            'sdk-current',
        );

        expect(result.state).toBe('same-session-reattach-required');
        expect(result.sameProviderBoundary).toBe(false);
        expect(result.headline).toBe(
            'seleção preparada cruza provedor ou perfil e requer reattach preservando a sessão atual',
        );
        expect(result.action).toContain('reatache a sessão atual');
        expect(result.headline).not.toMatch(/\bprovider\b|\bbinding\b|provider\/perfil/u);
    });
});
