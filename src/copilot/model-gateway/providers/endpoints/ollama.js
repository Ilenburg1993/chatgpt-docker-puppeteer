// @ts-check
export const OLLAMA_PROVIDER_ENDPOINTS = Object.freeze({
    providerId: 'ollama',
    adapterId: 'ollama',
    providerKind: 'local_or_cloud_daemon',
    baseUrls: Object.freeze(['http://localhost:11434/api', 'http://localhost:11434/v1', 'https://ollama.com/api']),
    modelCatalogSources: Object.freeze([
        Object.freeze({ kind: 'local_daemon', method: 'GET', url: 'http://localhost:11434/api/tags', richness: 'local_digest_details' }),
        Object.freeze({ kind: 'local_daemon', method: 'POST', url: 'http://localhost:11434/api/show', richness: 'model_template_parameters' }),
    ]),
    runtimeEndpoints: Object.freeze([
        Object.freeze({ kind: 'generate', method: 'POST', path: '/api/generate' }),
        Object.freeze({ kind: 'chat', method: 'POST', path: '/api/chat' }),
        Object.freeze({ kind: 'openai_chat_completions', method: 'POST', path: '/v1/chat/completions' }),
    ]),
    routeSelectors: Object.freeze(['exact_model', 'local_tag', 'digest']),
});
