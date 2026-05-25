// @ts-check
/** @type {import('../openai-provider-family-adapter.js').OpenAIProviderFamilySpec} */
export const HUGGINGFACE_PROVIDER_SPEC = Object.freeze({
    id: 'huggingface',
    providerIds: Object.freeze(['huggingface']),
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    gateway: Object.freeze({
        providerSelectionPolicySuffixes: Object.freeze([':fastest', ':cheapest', ':preferred']),
        selectorSyntax: 'model[:fastest|:cheapest|:preferred|:provider]',
    }),
});
