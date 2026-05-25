// @ts-check
export const GEMINI_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'gemini',
    adapterId: 'gemini',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze([
        'https://generativelanguage.googleapis.com/v1beta',
        'https://generativelanguage.googleapis.com/v1beta/openai',
    ]),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'authenticated_api',
            method: 'GET',
            url: 'https://generativelanguage.googleapis.com/v1beta/models',
            richness: 'limits_methods_parameters',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'generate_content', method: 'POST', path: '/models/{model}:generateContent' }),
        Object.freeze({ kind: 'openai_chat_completions', method: 'POST', path: '/openai/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'api_version']),
});
