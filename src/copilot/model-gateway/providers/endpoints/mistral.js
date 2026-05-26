// @ts-check
export const MISTRAL_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'mistral',
    adapterId: 'mistral',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze(['https://api.mistral.ai/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'authenticated_api',
            method: 'GET',
            url: 'https://api.mistral.ai/v1/models',
            richness: 'capabilities_context_lifecycle',
        }),
        Object.freeze({
            kind: 'official_docs',
            method: 'GET',
            url: 'https://docs.mistral.ai/models/overview',
            richness: 'identity_pricing_limits_capabilities_lifecycle_docs',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
        Object.freeze({ kind: 'fim_completions', method: 'POST', path: '/fim/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'alias', 'replacement_model']),
});
