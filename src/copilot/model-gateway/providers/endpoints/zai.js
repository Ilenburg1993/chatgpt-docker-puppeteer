// @ts-check
export const ZAI_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'zai',
    adapterId: 'zai',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze(['https://api.z.ai/api/paas/v4']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'docs_or_authenticated_api_tbd',
            method: 'GET',
            url: 'https://docs.z.ai/guides/',
            richness: 'needs_endpoint_split_investigation',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'coding_plan', 'vision_family', 'anthropic_compatible_variant']),
});
