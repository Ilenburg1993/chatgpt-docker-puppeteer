// @ts-check
export const OPENAI_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'openai',
    adapterId: 'openai',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze(['https://api.openai.com/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'authenticated_api',
            method: 'GET',
            url: 'https://api.openai.com/v1/models',
            richness: 'identity',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
        Object.freeze({ kind: 'responses', method: 'POST', path: '/responses' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'alias']),
});
