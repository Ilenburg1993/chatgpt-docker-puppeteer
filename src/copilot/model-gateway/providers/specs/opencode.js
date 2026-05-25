// @ts-check
/** @type {import('../openai-provider-family-adapter.js').OpenAIProviderFamilySpec} */
export const OPENCODE_PROVIDER_SPEC = Object.freeze({
    id: 'opencode',
    providerIds: Object.freeze(['opencode']),
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    gateway: Object.freeze({
        catalogEndpoint: 'https://opencode.ai/zen/v1/models',
        responsesEndpoint: 'https://opencode.ai/zen/v1/responses',
        messagesEndpoint: 'https://opencode.ai/zen/v1/messages',
        chatCompletionsEndpoint: 'https://opencode.ai/zen/v1/chat/completions',
        selectorSyntax: 'model',
    }),
});
