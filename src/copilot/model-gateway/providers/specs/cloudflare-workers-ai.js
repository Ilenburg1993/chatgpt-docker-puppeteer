// @ts-check
/** @type {import('../openai-provider-family-adapter.js').OpenAIProviderFamilySpec} */
export const CLOUDFLARE_WORKERS_AI_PROVIDER_SPEC = Object.freeze({
    id: 'cloudflare-workers-ai',
    providerIds: Object.freeze(['cloudflare-workers-ai']),
    defaultBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    gateway: Object.freeze({
        requiresAccountId: true,
        catalogEndpoint: 'https://developers.cloudflare.com/ai/models/',
        workersAiRestPattern: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}',
        aiGatewayUniversalPattern: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}',
    }),
});
