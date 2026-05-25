// @ts-check
export const CEREBRAS_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'cerebras',
    adapterId: 'cerebras',
    providerKind: 'direct_provider',
    baseUrls: Object.freeze(['https://api.cerebras.ai/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'authenticated_api',
            method: 'GET',
            url: 'https://api.cerebras.ai/v1/models',
            richness: 'identity_owner',
        }),
        Object.freeze({
            kind: 'public_api',
            method: 'GET',
            url: 'https://api.cerebras.ai/public/v1/models',
            richness: 'public_model_architectures',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model']),
});
