// @ts-check

import { describe, expect, it } from 'vitest';

import { buildModelGatewayRuntimeSelectorProbeEnv } from '../../../../src/copilot/model-gateway/routing/runtime-selector.js';
import { resolveModelGatewaySessionBinding } from '../../../../src/copilot/model-gateway/session/session-binding.js';

describe('model gateway session binding', () => {
    it('does not pass SDK reasoningEffort for Ollama Cloud completions routes even when model metadata says reasoning', () => {
        const route = {
            providerId: 'ollama-cloud',
            providerModel: 'qwen3-coder-next',
            selectorSyntax: 'qwen3-coder-next',
            baseUrl: 'https://ollama.com/v1',
            openAICompatibleBaseUrl: 'https://ollama.com/v1',
            wireApi: 'completions',
            providerProfile: 'ollama-cloud',
            routeProfile: 'live_minimal_provider_switch',
            selectedRouteKey: 'live-route-minimal:ollama-cloud:qwen3-coder-next',
        };
        const env = buildModelGatewayRuntimeSelectorProbeEnv(route, {
            OLLAMA_CLOUD_API_KEY: 'unit-secret',
            COPILOT_BYOK_PROFILES_JSON: JSON.stringify({
                'ollama-cloud': {
                    providerId: 'ollama-cloud',
                    providerType: 'openai',
                    baseUrl: 'https://ollama.com/v1',
                    model: 'qwen3-coder-next',
                    apiKeyEnv: 'OLLAMA_CLOUD_API_KEY',
                    modelsJson: [
                        {
                            id: 'qwen3-coder-next',
                            capabilities: { supports: { reasoningEffort: true } },
                        },
                    ],
                },
            }),
        });

        const binding = resolveModelGatewaySessionBinding(env, 'qwen3-coder-next');

        expect(binding.enabled).toBe(true);
        expect(binding.gatewayBinding).toMatchObject({
            source: 'gateway_route',
            providerId: 'ollama-cloud',
            providerModel: 'qwen3-coder-next',
        });
        expect(binding.summary.capabilities.reasoningEffort).toBe(false);
        expect(binding.summary.capabilities.sdkReasoningEffort).toBe(false);
        expect(binding.supportsReasoning).toBe(false);
        expect(binding.modelCapabilities?.supports?.reasoningEffort).toBe(false);
    });
});
