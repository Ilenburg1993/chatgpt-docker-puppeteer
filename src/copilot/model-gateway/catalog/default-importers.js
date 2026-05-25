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
    createKiloGatewayModelsImporter,
    createKiloGatewayProvidersImporter,
    createOpenAICompatibleModelsImporter,
    createOpenAIModelsImporter,
    createOpenRouterModelsImporter,
} from './importers/index.js';

const OPENAI_COMPATIBLE_ACCOUNT_SOURCES = Object.freeze([
    Object.freeze({
        providerId: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        envKeys: Object.freeze(['GROQ_API_KEY', 'GROQ_KEY']),
    }),
    Object.freeze({
        providerId: 'cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
        envKeys: Object.freeze(['CEREBRAS_API_KEY', 'CEREBRAS_KEY']),
    }),
    Object.freeze({
        providerId: 'chutes',
        baseUrl: 'https://llm.chutes.ai/v1',
        envKeys: Object.freeze(['CHUTES_API_KEY', 'CHUTES_AI']),
    }),
    Object.freeze({
        providerId: 'zai',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        envKeys: Object.freeze(['ZAI_API_KEY', 'Z_AI_KEY']),
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
    /** @type {import('./importer-runner.js').CatalogImporter[]} */
    const importers = [];
    if (includePublic) {
        importers.push(
            createOpenRouterModelsImporter({ fetchImpl: options.fetchImpl }),
            createKiloGatewayModelsImporter({ fetchImpl: options.fetchImpl }),
            createKiloGatewayProvidersImporter({ fetchImpl: options.fetchImpl }),
        );
    }
    const openAiSecret = readEnvSecret(env, ['OPENAI_API_KEY', 'COPILOT_OPENAI_API_KEY']);
    if (includeAuthenticated && openAiSecret) {
        importers.push(
            createOpenAIModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: openAiSecret.value,
                secretRef: openAiSecret.key,
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
