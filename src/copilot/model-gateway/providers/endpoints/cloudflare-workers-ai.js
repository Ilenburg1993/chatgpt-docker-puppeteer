// @ts-check
export const CLOUDFLARE_WORKERS_AI_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'cloudflare-workers-ai',
    adapterId: 'cloudflare-workers-ai',
    providerKind: 'gateway_or_direct_provider',
    baseUrls: Object.freeze([
        'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
        'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}',
    ]),
    modelCatalogSources: Object.freeze([
        Object.freeze({
            kind: 'public_catalog',
            method: 'GET',
            url: 'https://developers.cloudflare.com/ai/models/',
            richness: 'task_modality_provider_catalog',
        }),
        Object.freeze({
            kind: 'authenticated_account_api',
            method: 'GET',
            url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/models/search',
            richness: 'account_visible_models',
        }),
        Object.freeze({
            kind: 'authenticated_account_api',
            method: 'GET',
            url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways',
            richness: 'account_gateway_controls',
        }),
        Object.freeze({
            kind: 'authenticated_account_api',
            method: 'GET',
            url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/provider_configs',
            richness: 'account_provider_key_controls',
        }),
        Object.freeze({
            kind: 'authenticated_account_api',
            method: 'GET',
            url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/billing/credit-balance',
            richness: 'account_credit_balance',
        }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({
            kind: 'workers_ai_run',
            method: 'POST',
            path: '/client/v4/accounts/{account_id}/ai/run/{model}',
        }),
        Object.freeze({ kind: 'ai_gateway_universal', method: 'POST', path: '/v1/{account_id}/{gateway_id}' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'gateway_fallback', 'gateway_retry', 'gateway_cache']),
});
