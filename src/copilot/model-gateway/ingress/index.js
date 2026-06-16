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
    buildModelGatewayIngressSessionOverrides,
    buildModelGatewayIngressUpstreamRequest,
    createModelGatewayIngressRoute,
    proxyModelGatewayIngressOpenAIChatCompletions,
    redactModelGatewayIngressRoute,
} from './openai-compatible-ingress.js';

export {
    ModelGatewayIngressRouteRegistry,
    createModelGatewayIngressRouteRegistry,
    defaultModelGatewayIngressRouteRegistry,
} from './route-registry.js';
