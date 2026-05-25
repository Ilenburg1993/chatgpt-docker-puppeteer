// @ts-check
export const ZAI_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'zai',
    adapterId: 'zai',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze(['https://api.z.ai/api/paas/v4']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'docs_pricing_markdown',
            method: 'GET',
            url: 'https://docs.z.ai/guides/overview/pricing.md',
            richness: 'model_prices_sections_cache_and_builtin_tool_prices',
        }),
        Object.freeze({
            kind: 'openapi',
            method: 'GET',
            url: 'https://docs.z.ai/openapi.json',
            richness: 'runtime_schema_tool_streaming_and_multimodal_parameters',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'coding_plan', 'vision_family', 'anthropic_compatible_variant']),
});
