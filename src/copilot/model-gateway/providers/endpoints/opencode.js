// @ts-check
export const OPENCODE_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'opencode',
    adapterId: 'opencode',
    providerKind: 'curated_gateway',
    baseUrls: Object.freeze(['https://opencode.ai/zen/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_docs',
            method: 'GET',
            url: 'https://opencode.ai/docs/zen/',
            richness: 'global_endpoint_pricing_tiers_deprecation_privacy',
        }),
        Object.freeze({
            kind: 'public_or_authenticated_api',
            method: 'GET',
            url: 'https://opencode.ai/zen/v1/models',
            richness: 'identity_docs_endpoint_pricing_lifecycle',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'openai_responses', method: 'POST', path: '/responses' }),
        Object.freeze({ kind: 'anthropic_messages', method: 'POST', path: '/messages' }),
        Object.freeze({ kind: 'google_model', method: 'POST', path: '/models/{model}' }),
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'wire_api_family']),
});
