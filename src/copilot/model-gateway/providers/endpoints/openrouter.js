// @ts-check
export const OPENROUTER_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'openrouter',
    adapterId: 'openrouter',
    providerKind: 'aggregator',
    baseUrls: Object.freeze(['https://openrouter.ai/api/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_api',
            method: 'GET',
            url: 'https://openrouter.ai/api/v1/models',
            richness: 'rich_route_metadata',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'aggregator_auto', 'provider_order', 'fallback_chain']),
});
