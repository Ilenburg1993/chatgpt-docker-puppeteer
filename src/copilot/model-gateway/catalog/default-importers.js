// @ts-check
/**
 * Default catalog importer composition.
 *
 * This small composition layer keeps command/script entrypoints from knowing provider-specific constructors. The
 * returned importers still normalize into the universal evidence pipeline and OpenAI-compatible projection.
 *
 * @module copilot/model-gateway/catalog/default-importers
 */

import {
    createAnthropicDocsModelsImporter,
    createAnthropicModelsImporter,
    createCerebrasPublicModelsImporter,
    createChutesModelsImporter,
    createCloudflareWorkersAiCatalogImporter,
    createGeminiDocsModelsImporter,
    createGeminiModelsImporter,
    createGroqDocsModelsImporter,
    createGroqModelsImporter,
    createHuggingFaceInferenceProvidersImporter,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createMistralDocsModelsImporter,
    createMistralModelsImporter,
    createNvidiaNimModelsImporter,
    createOllamaCatalogImporter,
    createOpenCodeZenDocsImporter,
    createOpenCodeZenModelsImporter,
    createOpenAiDocsModelsImporter,
    createOpenAICompatibleModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterKeyAccountImporter,
    createOpenRouterModelsImporter,
    createZaiModelsImporter,
} from './importers/index.js';

const OPENAI_COMPATIBLE_ACCOUNT_SOURCES = Object.freeze([
    Object.freeze({
        providerId: 'cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
        envKeys: Object.freeze(['CEREBRAS_API_KEY', 'CEREBRAS_KEY']),
    }),
]);

/**
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} keys
 * @returns {{ key: string; value: string } | null}
 */
function readEnvSecret(env, keys) {
    for (const key of keys) {
        const value = env[key];
        if (value) return { key, value };
    }
    return null;
}

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.includePublic]
 * @param {boolean} [options.includeAuthenticated]
 * @returns {import('./importer-runner.js').CatalogImporter[]}
 */
export function createDefaultModelGatewayCatalogImporters(options = {}) {
    const env = options.env ?? process.env;
    const includePublic = options.includePublic ?? true;
    const includeAuthenticated = options.includeAuthenticated ?? true;
    const cloudflareSecret = readEnvSecret(env, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_KEY']);
    const openRouterSecret = readEnvSecret(env, ['OPENROUTER_API_KEY', 'OPEN_ROUTER_KEY']);
    const openAiSecret = readEnvSecret(env, ['OPENAI_API_KEY', 'COPILOT_OPENAI_API_KEY']);
    const mistralSecret = readEnvSecret(env, ['MISTRAL_API_KEY', 'MISTRAL_KEY']);
    const anthropicSecret = readEnvSecret(env, ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY', 'CLAUDE_API_KEY']);
    const geminiSecret = readEnvSecret(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_STUDIO_API_KEY']);
    const groqSecret = readEnvSecret(env, ['GROQ_API_KEY', 'GROQ_KEY']);
    const huggingFaceSecret = readEnvSecret(env, ['HF_TOKEN', 'HUGGINGFACE_API_TOKEN', 'HUGGING_FACE_API_KEY', 'HUGGING_FACE_KEY']);
    const openCodeSecret = readEnvSecret(env, ['OPENCODE_API_KEY']);
    const nvidiaSecret = readEnvSecret(env, ['NVIDIA_API_KEY', 'NVIDIA_KEY']);
    const chutesSecret = readEnvSecret(env, ['CHUTES_API_KEY', 'CHUTES_AI']);
    const zaiSecret = readEnvSecret(env, ['ZAI_API_KEY', 'Z_AI_KEY']);
    /** @type {import('./importer-runner.js').CatalogImporter[]} */
    const importers = [];
    if (includePublic) {
        importers.push(
            createOpenRouterModelsImporter({ fetchImpl: options.fetchImpl }),
            createKiloGatewayModelsImporter({ fetchImpl: options.fetchImpl }),
            createKiloGatewayProvidersImporter({ fetchImpl: options.fetchImpl }),
            createCerebrasPublicModelsImporter({ fetchImpl: options.fetchImpl }),
            createOpenAiDocsModelsImporter({ fetchImpl: options.fetchImpl }),
            createAnthropicDocsModelsImporter({ fetchImpl: options.fetchImpl }),
            createGeminiDocsModelsImporter({ fetchImpl: options.fetchImpl }),
            createMistralDocsModelsImporter({ fetchImpl: options.fetchImpl }),
            createGroqDocsModelsImporter({ fetchImpl: options.fetchImpl }),
            createOpenCodeZenDocsImporter({ fetchImpl: options.fetchImpl }),
            createCloudflareWorkersAiCatalogImporter({
                fetchImpl: options.fetchImpl,
                apiToken: includeAuthenticated ? cloudflareSecret?.value : undefined,
                secretRef: includeAuthenticated ? cloudflareSecret?.key : undefined,
                accountId: env['CLOUDFLARE_ACCOUNT_ID'],
                gatewayId: env['CLOUDFLARE_AI_GATEWAY_ID'],
            }),
        );
        if (!includeAuthenticated || !huggingFaceSecret) {
            importers.push(createHuggingFaceInferenceProvidersImporter({ fetchImpl: options.fetchImpl }));
        }
        if (!includeAuthenticated || !openCodeSecret) {
            importers.push(createOpenCodeZenModelsImporter({ fetchImpl: options.fetchImpl }));
        }
        if (!includeAuthenticated || !chutesSecret) {
            importers.push(createChutesModelsImporter({ fetchImpl: options.fetchImpl }));
        }
        if (!includeAuthenticated || !zaiSecret) {
            importers.push(createZaiModelsImporter({ fetchImpl: options.fetchImpl }));
        }
    }
    const ollamaBaseUrl = readEnvSecret(env, ['OLLAMA_BASE_URL', 'OLLAMA_HOST', 'COPILOT_OLLAMA_BASE_URL']);
    if (includePublic && ollamaBaseUrl) {
        importers.push(createOllamaCatalogImporter({ fetchImpl: options.fetchImpl, baseUrl: ollamaBaseUrl.value }));
    }
    if (includeAuthenticated && openAiSecret) {
        importers.push(
            createOpenAIModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: openAiSecret.value,
                secretRef: openAiSecret.key,
            }),
        );
    }
    if (includeAuthenticated && openRouterSecret) {
        importers.push(
            createOpenRouterKeyAccountImporter({
                fetchImpl: options.fetchImpl,
                apiKey: openRouterSecret.value,
                secretRef: openRouterSecret.key,
            }),
        );
    }
    if (includeAuthenticated && mistralSecret) {
        importers.push(
            createMistralModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: mistralSecret.value,
                secretRef: mistralSecret.key,
            }),
        );
    }
    if (includeAuthenticated && anthropicSecret) {
        importers.push(
            createAnthropicModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: anthropicSecret.value,
                secretRef: anthropicSecret.key,
            }),
        );
    }
    if (includeAuthenticated && geminiSecret) {
        importers.push(
            createGeminiModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: geminiSecret.value,
                secretRef: geminiSecret.key,
            }),
        );
    }
    if (includeAuthenticated && groqSecret) {
        importers.push(
            createGroqModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: groqSecret.value,
                secretRef: groqSecret.key,
            }),
        );
    }
    if (includeAuthenticated && huggingFaceSecret) {
        importers.push(
            createHuggingFaceInferenceProvidersImporter({
                fetchImpl: options.fetchImpl,
                apiKey: huggingFaceSecret.value,
                secretRef: huggingFaceSecret.key,
            }),
        );
    }
    if (includeAuthenticated && openCodeSecret) {
        importers.push(
            createOpenCodeZenModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: openCodeSecret.value,
                secretRef: openCodeSecret.key,
            }),
        );
    }
    if (includeAuthenticated && nvidiaSecret) {
        importers.push(
            createNvidiaNimModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: nvidiaSecret.value,
                secretRef: nvidiaSecret.key,
            }),
        );
    }
    if (includeAuthenticated && chutesSecret) {
        importers.push(
            createChutesModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: chutesSecret.value,
                secretRef: chutesSecret.key,
            }),
        );
    }
    if (includeAuthenticated && zaiSecret) {
        importers.push(
            createZaiModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: zaiSecret.value,
                secretRef: zaiSecret.key,
            }),
        );
    }
    if (includeAuthenticated) {
        for (const source of OPENAI_COMPATIBLE_ACCOUNT_SOURCES) {
            const secret = readEnvSecret(env, source.envKeys);
            if (!secret) continue;
            importers.push(
                createOpenAICompatibleModelsImporter({
                    providerId: source.providerId,
                    baseUrl: source.baseUrl,
                    fetchImpl: options.fetchImpl,
                    apiKey: secret.value,
                    secretRef: secret.key,
                    envRequirements: [secret.key],
                }),
            );
        }
    }
    return importers;
}
