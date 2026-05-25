// @ts-check
export const HUGGINGFACE_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'huggingface',
    adapterId: 'huggingface',
    providerKind: 'aggregator',
    baseUrls: Object.freeze(['https://router.huggingface.co/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_catalog',
            method: 'GET',
            url: 'https://huggingface.co/docs/inference-providers',
            richness: 'provider_policy_pricing_context',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['fastest', 'cheapest', 'preferred', 'provider_explicit', 'auto']),
});
