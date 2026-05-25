// @ts-check
export const GROQ_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'groq',
    adapterId: 'groq',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze(['https://api.groq.com/openai/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_docs',
            method: 'GET',
            url: 'https://console.groq.com/docs/models',
            richness: 'global_pricing_limits_rate_limits_speed',
        }),
        Object.freeze({
            kind: 'public_docs',
            method: 'GET',
            url: 'https://groq.com/pricing',
            richness: 'global_pricing_prompt_caching_builtin_tools',
        }),
        Object.freeze({
            kind: 'authenticated_api',
            method: 'GET',
            url: 'https://api.groq.com/openai/v1/models',
            richness: 'identity_account_scoped',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model']),
});
