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
    createCerebrasModelsImporter,
    createCerebrasPublicModelsImporter,
    createChutesModelsImporter,
    createCloudflareWorkersAiAccountImporter,
    createCloudflareWorkersAiCatalogImporter,
    createGeminiDocsModelsImporter,
    createGeminiModelsImporter,
    createGroqDocsModelsImporter,
    createGroqModelsImporter,
    createHuggingFaceInferenceProvidersImporter,
    createKiloGatewayAccountImporter,
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createMistralDocsModelsImporter,
    createMistralModelsImporter,
    createNvidiaNimModelsImporter,
    createOllamaCatalogImporter,
    createOpenCodeZenDocsImporter,
    createOpenCodeZenModelsImporter,
    createOpenAiDocsModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterKeyAccountImporter,
    createOpenRouterModelsImporter,
    createZaiModelsImporter,
    createZaiOpenApiImporter,
} from './importers/index.js';

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
 * @param {import('./importers/http-port.js').CatalogFetch} [options.fetchImpl]
 * @param {boolean} [options.includePublic]
 * @param {boolean} [options.includeAuthenticated]
 * @returns {import('./importer-runner.js').CatalogImporter[]}
 */
export function createDefaultModelGatewayCatalogImporters(options = {}) {
    const env = options.env ?? process.env;
    const includePublic = options.includePublic ?? true;
    const includeAuthenticated = options.includeAuthenticated ?? true;
    const fetchOptions = options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl };
    const cloudflareSecret = readEnvSecret(env, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_KEY']);
    const openRouterSecret = readEnvSecret(env, ['OPENROUTER_API_KEY', 'OPEN_ROUTER_KEY']);
    const openAiSecret = readEnvSecret(env, ['OPENAI_API_KEY', 'COPILOT_OPENAI_API_KEY']);
    const cerebrasSecret = readEnvSecret(env, ['CEREBRAS_API_KEY', 'CEREBRAS_KEY']);
    const mistralSecret = readEnvSecret(env, ['MISTRAL_API_KEY', 'MISTRAL_KEY']);
    const anthropicSecret = readEnvSecret(env, ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY', 'CLAUDE_API_KEY']);
    const geminiSecret = readEnvSecret(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_AI_STUDIO_API_KEY']);
    const groqSecret = readEnvSecret(env, ['GROQ_API_KEY', 'GROQ_KEY']);
    const huggingFaceSecret = readEnvSecret(env, ['HF_TOKEN', 'HUGGINGFACE_API_TOKEN', 'HUGGING_FACE_API_KEY', 'HUGGING_FACE_KEY']);
    const kiloSecret = readEnvSecret(env, ['KILO_API_KEY', 'KILO_CODE_API_KEY', 'KILOCODE_API_KEY']);
    const openCodeSecret = readEnvSecret(env, ['OPENCODE_API_KEY']);
    const nvidiaSecret = readEnvSecret(env, ['NVIDIA_API_KEY', 'NVIDIA_KEY']);
    const chutesSecret = readEnvSecret(env, ['CHUTES_API_KEY', 'CHUTES_AI']);
    const zaiSecret = readEnvSecret(env, ['ZAI_API_KEY', 'Z_AI_KEY']);
    /** @type {import('./importer-runner.js').CatalogImporter[]} */
    const importers = [];
    if (includePublic) {
        importers.push(
            createOpenRouterModelsImporter({ ...fetchOptions }),
            createKiloGatewayModelsImporter({ ...fetchOptions }),
            createKiloGatewayProvidersImporter({ ...fetchOptions }),
            createCerebrasPublicModelsImporter({ ...fetchOptions }),
            createOpenAiDocsModelsImporter({ ...fetchOptions }),
            createAnthropicDocsModelsImporter({ ...fetchOptions }),
            createGeminiDocsModelsImporter({ ...fetchOptions }),
            createMistralDocsModelsImporter({ ...fetchOptions }),
            createGroqDocsModelsImporter({ ...fetchOptions }),
            createOpenCodeZenDocsImporter({ ...fetchOptions }),
            createZaiOpenApiImporter({ ...fetchOptions }),
            createCloudflareWorkersAiCatalogImporter({
                ...fetchOptions,
                ...(includeAuthenticated && cloudflareSecret
                    ? { apiToken: cloudflareSecret.value, secretRef: cloudflareSecret.key }
                    : {}),
                ...(env['CLOUDFLARE_ACCOUNT_ID'] === undefined ? {} : { accountId: env['CLOUDFLARE_ACCOUNT_ID'] }),
                ...(env['CLOUDFLARE_AI_GATEWAY_ID'] === undefined ? {} : { gatewayId: env['CLOUDFLARE_AI_GATEWAY_ID'] }),
            }),
        );
        if (!includeAuthenticated || !huggingFaceSecret) {
            importers.push(createHuggingFaceInferenceProvidersImporter({ ...fetchOptions }));
        }
        if (!includeAuthenticated || !openCodeSecret) {
            importers.push(createOpenCodeZenModelsImporter({ ...fetchOptions }));
        }
        if (!includeAuthenticated || !chutesSecret) {
            importers.push(createChutesModelsImporter({ ...fetchOptions }));
        }
        if (!includeAuthenticated || !zaiSecret) {
            importers.push(createZaiModelsImporter({ ...fetchOptions }));
        }
    }
    const ollamaBaseUrl = readEnvSecret(env, ['OLLAMA_BASE_URL', 'OLLAMA_HOST', 'COPILOT_OLLAMA_BASE_URL']);
    if (includePublic && ollamaBaseUrl) {
        importers.push(createOllamaCatalogImporter({ ...fetchOptions, baseUrl: ollamaBaseUrl.value }));
    }
    if (includeAuthenticated && openAiSecret) {
        importers.push(
            createOpenAIModelsImporter({
                ...fetchOptions,
                apiKey: openAiSecret.value,
                secretRef: openAiSecret.key,
            }),
        );
    }
    if (includeAuthenticated && cerebrasSecret) {
        importers.push(
            createCerebrasModelsImporter({
                ...fetchOptions,
                apiKey: cerebrasSecret.value,
                secretRef: cerebrasSecret.key,
            }),
        );
    }
    if (includeAuthenticated && openRouterSecret) {
        importers.push(
            createOpenRouterKeyAccountImporter({
                ...fetchOptions,
                apiKey: openRouterSecret.value,
                secretRef: openRouterSecret.key,
            }),
        );
    }
    if (includeAuthenticated && kiloSecret) {
        importers.push(
            createKiloGatewayAccountImporter({
                ...fetchOptions,
                apiKey: kiloSecret.value,
                secretRef: kiloSecret.key,
                ...(env['KILO_ORGANIZATION_ID'] === undefined
                    ? {}
                    : { organizationId: env['KILO_ORGANIZATION_ID'], organizationIdRef: 'KILO_ORGANIZATION_ID' }),
            }),
        );
    }
    if (includeAuthenticated && cloudflareSecret && env['CLOUDFLARE_ACCOUNT_ID']) {
        importers.push(
            createCloudflareWorkersAiAccountImporter({
                ...fetchOptions,
                apiToken: cloudflareSecret.value,
                secretRef: cloudflareSecret.key,
                accountId: env['CLOUDFLARE_ACCOUNT_ID'],
                ...(env['CLOUDFLARE_AI_GATEWAY_ID'] === undefined ? {} : { gatewayId: env['CLOUDFLARE_AI_GATEWAY_ID'] }),
            }),
        );
    }
    if (includeAuthenticated && mistralSecret) {
        importers.push(
            createMistralModelsImporter({
                ...fetchOptions,
                apiKey: mistralSecret.value,
                secretRef: mistralSecret.key,
            }),
        );
    }
    if (includeAuthenticated && anthropicSecret) {
        importers.push(
            createAnthropicModelsImporter({
                ...fetchOptions,
                apiKey: anthropicSecret.value,
                secretRef: anthropicSecret.key,
            }),
        );
    }
    if (includeAuthenticated && geminiSecret) {
        importers.push(
            createGeminiModelsImporter({
                ...fetchOptions,
                apiKey: geminiSecret.value,
                secretRef: geminiSecret.key,
            }),
        );
    }
    if (includeAuthenticated && groqSecret) {
        importers.push(
            createGroqModelsImporter({
                ...fetchOptions,
                apiKey: groqSecret.value,
                secretRef: groqSecret.key,
            }),
        );
    }
    if (includeAuthenticated && huggingFaceSecret) {
        importers.push(
            createHuggingFaceInferenceProvidersImporter({
                ...fetchOptions,
                apiKey: huggingFaceSecret.value,
                secretRef: huggingFaceSecret.key,
            }),
        );
    }
    if (includeAuthenticated && openCodeSecret) {
        importers.push(
            createOpenCodeZenModelsImporter({
                ...fetchOptions,
                apiKey: openCodeSecret.value,
                secretRef: openCodeSecret.key,
            }),
        );
    }
    if (includeAuthenticated && nvidiaSecret) {
        importers.push(
            createNvidiaNimModelsImporter({
                ...fetchOptions,
                apiKey: nvidiaSecret.value,
                secretRef: nvidiaSecret.key,
            }),
        );
    }
    if (includeAuthenticated && chutesSecret) {
        importers.push(
            createChutesModelsImporter({
                ...fetchOptions,
                apiKey: chutesSecret.value,
                secretRef: chutesSecret.key,
            }),
        );
    }
    if (includeAuthenticated && zaiSecret) {
        importers.push(
            createZaiModelsImporter({
                ...fetchOptions,
                apiKey: zaiSecret.value,
                secretRef: zaiSecret.key,
            }),
        );
    }
    return importers;
}
