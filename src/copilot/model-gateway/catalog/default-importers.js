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
    createOpenAIModelsImporter,
    createOpenRouterModelsImporter,
} from './importers/index.js';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ key: string; value: string } | null}
 */
function readOpenAiSecret(env) {
    if (env['OPENAI_API_KEY']) return { key: 'OPENAI_API_KEY', value: env['OPENAI_API_KEY'] };
    if (env['COPILOT_OPENAI_API_KEY']) return { key: 'COPILOT_OPENAI_API_KEY', value: env['COPILOT_OPENAI_API_KEY'] };
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
    if (includePublic) importers.push(createOpenRouterModelsImporter({ fetchImpl: options.fetchImpl }));
    const openAiSecret = readOpenAiSecret(env);
    if (includeAuthenticated && openAiSecret) {
        importers.push(
            createOpenAIModelsImporter({
                fetchImpl: options.fetchImpl,
                apiKey: openAiSecret.value,
                secretRef: openAiSecret.key,
            }),
        );
    }
    return importers;
}
