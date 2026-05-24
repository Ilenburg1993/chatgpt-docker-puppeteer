// @ts-check
/**
 * Gateway snapshot builders.
 *
 * @module copilot/model-gateway/registry/snapshot
 */

import { MODEL_GATEWAY_SCHEMA_VERSION } from '../contracts/records.js';
import { ModelGatewayRegistry } from './model-registry.js';
import { importConfiguredByokFromEnv } from './env-byok-compat-importer.js';
import { JsonModelGatewayRegistryStore } from './json-registry-store.js';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{
 *     schemaVersion: number;
 *     generatedAt: string;
 *     source: string;
 *     active: object;
 *     providers: object[];
 *     models: object[];
 *     diagnostics: { providerCount: number; modelCount: number; enabledModelCount: number; warnings: string[]; errors: string[] };
 * }}
 */
export function buildEnvByokModelGatewaySnapshot(env = process.env) {
    const registry = new ModelGatewayRegistry();
    const imported = importConfiguredByokFromEnv(env);
    if (imported.provider) registry.upsertProvider(imported.provider);
    for (const model of imported.models) registry.upsertModel(model);
    const snapshot = registry.snapshot();
    return {
        schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        source: 'env_compat',
        active: imported.active,
        providers: snapshot.providers,
        models: snapshot.models,
        diagnostics: {
            providerCount: snapshot.providers.length,
            modelCount: snapshot.models.length,
            enabledModelCount: registry.listEnabledModels().length,
            warnings: imported.warnings,
            errors: imported.errors,
        },
    };
}

/**
 * Builds the current env compat snapshot and persists it into the JSON registry store.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{ filePath?: string }} [options]
 * @returns {Promise<ReturnType<typeof buildEnvByokModelGatewaySnapshot> & { registryPath: string }>}
 */
export async function persistEnvByokModelGatewaySnapshot(env = process.env, options = {}) {
    const snapshot = buildEnvByokModelGatewaySnapshot(env);
    const store = new JsonModelGatewayRegistryStore(options);
    await store.writeSnapshot(snapshot);
    return {
        ...snapshot,
        registryPath: store.filePath,
    };
}
