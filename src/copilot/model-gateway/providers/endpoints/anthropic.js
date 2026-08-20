// @ts-check
export const ANTHROPIC_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'anthropic',
    adapterId: 'anthropic',
    providerKind: 'sdk_native',
    baseUrls: Object.freeze(['https://api.anthropic.com']),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'authenticated_api',
            method: 'GET',
            url: 'https://api.anthropic.com/v1/models',
            richness: 'identity_account_scoped',
        }),
        Object.freeze({
            kind: 'official_docs',
            method: 'GET',
            url: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
            richness: 'identity_pricing_limits_capabilities_lifecycle_routing_docs',
        }),
    ]),
    runtimeEndpoints: Object.freeze([Object.freeze({ kind: 'messages', method: 'POST', path: '/v1/messages' })]),
    routeSelectors: Object.freeze(['exact_model', 'alias']),
});
