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
 * @returns {string | null}
 */
function readOpenAiKey(env) {
    return env['OPENAI_API_KEY'] ?? env['COPILOT_OPENAI_API_KEY'] ?? null;
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
    const openAiKey = readOpenAiKey(env);
    if (includeAuthenticated && openAiKey) {
        importers.push(createOpenAIModelsImporter({ fetchImpl: options.fetchImpl, apiKey: openAiKey }));
    }
    return importers;
}

