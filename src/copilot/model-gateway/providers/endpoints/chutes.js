// @ts-check
export const CHUTES_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'chutes',
    adapterId: 'chutes',
    providerKind: 'openai_compatible_proxy',
    baseUrls: Object.freeze(['https://llm.chutes.ai/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'docs_or_authenticated_api_tbd',
            method: 'GET',
            url: 'https://docs.chutes.ai/',
            richness: 'needs_dedicated_investigation',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model']),
});
