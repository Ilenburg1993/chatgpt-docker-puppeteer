// @ts-check
export const KILO_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'kilo',
    providerAliases: Object.freeze(['kilo-code', 'kilo-gateway']),
    adapterId: 'kilo',
    providerKind: 'gateway',
    baseUrls: Object.freeze(['https://api.kilo.ai/api/gateway']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_gateway_api',
            method: 'GET',
            url: 'https://api.kilo.ai/api/gateway/models',
            richness: 'pricing_context_features',
        }),
        Object.freeze({
            kind: 'public_gateway_api',
            method: 'GET',
            url: 'https://api.kilo.ai/api/gateway/providers',
            richness: 'provider_upstream',
        }),
        Object.freeze({
            kind: 'authenticated_account_api',
            method: 'GET',
            url: 'https://api.kilo.ai/api/gateway/models',
            richness: 'account_visible_models_policy_if_present',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'chat_completions', method: 'POST', path: '/chat/completions' }),
        Object.freeze({ kind: 'fim_completions', method: 'POST', path: '/fim/completions' }),
    ]),
    routeSelectors: Object.freeze([
        'exact_model',
        'gateway_auto',
        'provider_model',
        'organization_overlay',
        'byok_internal',
    ]),
});
