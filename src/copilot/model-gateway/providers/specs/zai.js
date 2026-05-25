// @ts-check
/** @type {import('../openai-provider-family-adapter.js').OpenAIProviderFamilySpec} */
export const ZAI_PROVIDER_SPEC = Object.freeze({
    id: 'zai',
    providerIds: Object.freeze(['zai']),
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    headers: Object.freeze({ 'Accept-Language': 'en-US,en' }),
});
