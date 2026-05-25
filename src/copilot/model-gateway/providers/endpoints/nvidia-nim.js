// @ts-check
export const NVIDIA_NIM_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'nvidia-nim',
    adapterId: 'nvidia-nim',
    providerKind: 'direct_provider_or_self_hosted_microservice',
    baseUrls: Object.freeze(['https://integrate.api.nvidia.com/v1']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_catalog',
            method: 'GET',
            url: 'https://docs.api.nvidia.com/nim/docs/introduction',
            richness: 'microservice_catalog_docs',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'hosted_or_self_hosted']),
});
