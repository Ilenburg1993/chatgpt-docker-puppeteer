// @ts-check

import { describe, expect, it } from 'vitest';
import {
    applyModelGatewayBindingStrategy,
    resolveModelGatewayBindingStrategy,
} from '../../../../src/copilot/model-gateway/index.js';

describe('model gateway automatic binding strategy', () => {
    it('mantém direct quando o rebind foi provado em runtime', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            runtimeEvidence: { sameSessionReattachOk: true },
        });

        expect(decision).toMatchObject({
            strategy: 'direct',
            directRebindReliability: 'proven',
            directRebindEvidenceSource: 'runtime_evidence',
            ingressEligible: true,
            sameSessionRequired: true,
            requiresNewSession: false,
        });
    });

    it('evidência runtime recente prevalece sobre capability estática otimista', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            directRebindReliable: true,
            runtimeEvidence: {
                directRebindOk: false,
                directRebindReliability: 'unreliable',
                latestStatus: 'route_rollback_confirmed_same_session',
            },
        });

        expect(decision).toMatchObject({
            strategy: 'ingress',
            source: 'automatic_ingress_fallback',
            directRebindReliability: 'unreliable',
            directRebindEvidenceSource: 'runtime_evidence',
            directBindingViability: 'unreliable',
            ingressEligible: true,
        });
    });

    it('seleciona ingress para direct explicitamente não confiável quando Chat Completions é elegível', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            directRebindReliable: false,
        });

        expect(decision).toMatchObject({
            strategy: 'ingress',
            source: 'automatic_ingress_fallback',
            directRebindReliability: 'unreliable',
            ingressEligible: true,
            ingressProtocol: 'openai_chat_completions',
        });
    });

    it('não interpreta header opcional do provider spec como requisito obrigatório de ingress', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'zai',
            providerModel: 'glm-4.5',
            baseUrl: 'https://api.z.ai/api/paas/v4',
            wireApi: 'completions',
        });

        expect(decision).toMatchObject({
            strategy: 'direct',
            directRebindReliability: 'documented',
            directBindingViability: 'documented',
            directConfigRepresentability: 'full',
            requiresNonStandardHeaders: false,
            ingressEligible: true,
        });
    });

    it('seleciona ingress quando um requisito direto explícito não cabe no ProviderConfig público', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'openrouter',
            providerModel: 'openai/gpt-oss-120b',
            baseUrl: 'https://openrouter.ai/api/v1',
            wireApi: 'completions',
            bindingCapabilities: {
                directConfigRepresentability: 'lossy',
                requiredDirectHeaders: ['x-required-provider-feature'],
                directConfigReason: 'provider_requires_header_not_exposed_by_sdk_provider_config',
            },
        });

        expect(decision).toMatchObject({
            strategy: 'ingress',
            directRebindReliability: 'documented',
            directBindingViability: 'unreliable',
            directConfigRepresentability: 'lossy',
            directConfigEvidenceSource: 'route_explicit_config_representability',
            requiredDirectHeaders: ['x-required-provider-feature'],
            requiresNonStandardHeaders: true,
            ingressEligible: true,
        });
        expect(decision.reasons).toContain('direct_config_representation_lossy');
    });

    it('mantém Anthropic em direct e nunca o converte para ingress Chat Completions', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'anthropic',
            providerModel: 'claude-sonnet-4-5',
            providerType: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            wireApi: 'messages',
        });

        expect(decision).toMatchObject({
            strategy: 'direct',
            providerType: 'anthropic',
            directRebindReliability: 'documented',
            ingressEligible: false,
        });
        expect(decision.warnings).toContain('direct_rebind_documented_but_not_runtime_proven');
    });

    it('bloqueia fallback ingress quando direct é não confiável mas a rota exige Responses API', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'openai',
            providerModel: 'gpt-5.2-codex',
            providerType: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            wireApi: 'responses',
            directRebindReliable: false,
        });

        expect(decision).toMatchObject({
            strategy: 'blocked',
            directRebindReliability: 'unreliable',
            ingressEligible: false,
        });
        expect(decision.reasons).toContain('ingress_responses_api_not_implemented');
    });

    it('falha fechado para override ingress incompatível', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'anthropic',
            providerModel: 'claude-sonnet-4-5',
            providerType: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            wireApi: 'messages',
            bindingStrategy: 'ingress',
        });

        expect(decision).toMatchObject({
            strategy: 'blocked',
            source: 'explicit_ingress_invalid',
            ingressEligible: false,
            requiresNewSession: false,
        });
    });

    it('preserva ingress e a identidade SDK-facing quando a sessão já está no ingress', () => {
        const route = applyModelGatewayBindingStrategy(
            {
                providerId: 'groq',
                providerModel: 'llama-3.3-70b-versatile',
                baseUrl: 'https://api.groq.com/openai/v1',
                wireApi: 'completions',
                routeProfile: 'repo_agent',
            },
            {
                sessionId: 'session-stable',
                currentRoute: {
                    providerId: 'openrouter',
                    providerModel: 'openrouter/free',
                    bindingStrategy: 'ingress',
                    sdkRouteKey: 'session-stable:repo_agent:model-gateway',
                    sdkVisibleModel: 'model-gateway-live',
                },
            },
        );

        expect(route).toMatchObject({
            bindingStrategy: 'ingress',
            sdkRouteKey: 'session-stable:repo_agent:model-gateway',
            sdkVisibleModel: 'model-gateway-live',
            requiresIngress: true,
            requiresNewSession: false,
            bindingDecision: {
                source: 'preserve_existing_ingress',
                strategy: 'ingress',
            },
        });
    });

    it('mantém direct por default para provider desconhecido e registra confiabilidade não comprovada', () => {
        const decision = resolveModelGatewayBindingStrategy({
            providerId: 'unknown-provider',
            providerModel: 'unknown-model',
            baseUrl: 'https://unknown.example.test/v1',
        });

        expect(decision).toMatchObject({
            strategy: 'direct',
            providerType: 'unknown',
            directRebindReliability: 'unknown',
            ingressEligible: false,
        });
        expect(decision.warnings).toContain('direct_rebind_reliability_unproven');
    });
});
