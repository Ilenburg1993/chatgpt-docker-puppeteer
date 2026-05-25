// @ts-check
/** @type {import('../openai-provider-family-adapter.js').OpenAIProviderFamilySpec} */
export const KILO_PROVIDER_SPEC = Object.freeze({
    id: 'kilo',
    providerIds: Object.freeze(['kilo', 'kilo-code', 'kilo-gateway']),
    defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
    gateway: Object.freeze({
        catalogEndpoint: 'https://api.kilo.ai/api/gateway/models',
        providersEndpoint: 'https://api.kilo.ai/api/gateway/providers',
        selectorSyntax: 'provider/model',
    }),
});
