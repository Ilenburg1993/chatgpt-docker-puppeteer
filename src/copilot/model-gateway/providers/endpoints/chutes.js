// @ts-check
export const CHUTES_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'chutes',
    adapterId: 'chutes',
    providerKind: 'openai_compatible_proxy',
    baseUrls: Object.freeze(['https://llm.chutes.ai/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_or_authenticated_openai_compatible_api',
            method: 'GET',
            url: 'https://llm.chutes.ai/v1/models',
            richness: 'pricing_modalities_features_limits_quantization_confidential_compute',
        }),
        Object.freeze({
            kind: 'docs',
            method: 'GET',
            url: 'https://docs.chutes.ai/',
            richness: 'runtime_setup_and_operational_docs',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model']),
});
