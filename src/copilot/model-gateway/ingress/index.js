// @ts-check
/**
 * Dynamic ingress/proxy helpers for Model Gateway.
 *
 * @module copilot/model-gateway/ingress
 */

export {
    MODEL_GATEWAY_INGRESS_DEFAULT_CHAT_COMPLETIONS_PATH,
    MODEL_GATEWAY_INGRESS_DEFAULT_LOCAL_API_KEY,
    MODEL_GATEWAY_INGRESS_HOP_BY_HOP_HEADERS,
    MODEL_GATEWAY_INGRESS_SENSITIVE_FORWARD_HEADERS,
    buildModelGatewayIngressPublicBaseUrl,
    buildModelGatewayIngressSessionOverrides,
    buildModelGatewayIngressUpstreamRequest,
    createModelGatewayIngressLocalApiKey,
    createModelGatewayIngressRoute,
    proxyModelGatewayIngressOpenAIChatCompletions,
    redactModelGatewayIngressRoute,
} from './openai-compatible-ingress.js';

export {
    MODEL_GATEWAY_BINDING_STRATEGIES,
    MODEL_GATEWAY_DIRECT_REBIND_RELIABILITY,
    MODEL_GATEWAY_UNKNOWN_REBIND_POLICIES,
    applyModelGatewayBindingStrategy,
    resolveModelGatewayBindingStrategy,
} from './binding-strategy.js';

export {
    ModelGatewayIngressRouteRegistry,
    createModelGatewayIngressRouteRegistry,
    defaultModelGatewayIngressRouteRegistry,
} from './route-registry.js';
