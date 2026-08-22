// @ts-check
/**
 * JSON-backed store for the model gateway registry.
 *
 * The store persists only redacted provider/model records. It intentionally does not resolve or store API keys, bearer
 * tokens or provider headers.
 *
 * @module copilot/model-gateway/registry/json-registry-store
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { createBoundJsonStore } from '#copilot/infra/public/persistence/json';
import { join, resolve } from 'node:path';
import { MODEL_GATEWAY_SCHEMA_VERSION } from '../contracts/records.js';
import { ModelGatewayRegistry } from './model-registry.js';

export const DEFAULT_MODEL_GATEWAY_REGISTRY_PATH = join(
    process.cwd(),
    'data',
    'copilot',
    'model-gateway',
    'registry.json',
);

const DEFAULT_MODEL_GATEWAY_REGISTRY_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'model-gateway.registry.json-store',
        exactPaths: [DEFAULT_MODEL_GATEWAY_REGISTRY_PATH],
        operations: ['read', 'stat', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function readRecordArray(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * @param {unknown} snapshot
 * @returns {{
 *     schemaVersion: number;
 *     generatedAt: string | null;
 *     source: string;
 *     providers: Record<string, unknown>[];
 *     models: Record<string, unknown>[];
 * }}
 */
export function normalizeStoredRegistrySnapshot(snapshot) {
    if (!isRecord(snapshot) || snapshot['schemaVersion'] !== MODEL_GATEWAY_SCHEMA_VERSION) {
        return {
            schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
            generatedAt: null,
            source: 'empty',
            providers: [],
            models: [],
        };
    }
    return {
        schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
        generatedAt: typeof snapshot['generatedAt'] === 'string' ? snapshot['generatedAt'] : null,
        source: typeof snapshot['source'] === 'string' ? snapshot['source'] : 'unknown',
        providers: readRecordArray(snapshot['providers']),
        models: readRecordArray(snapshot['models']),
    };
}

export class JsonModelGatewayRegistryStore {
    /** @type {string} */
    #filePath;
    /** @type {ReturnType<typeof createBoundJsonStore>} */
    #storage;

    /**
     * Alternate paths require an already-authorized IO capability; the store never mints authority from caller input.
     * @param {{
     *   filePath?: string;
     *   io?: ReturnType<typeof createConfiguredFsIo>;
     * }} [options]
     */
    constructor(options = {}) {
        const filePath = resolve(options.filePath ?? DEFAULT_MODEL_GATEWAY_REGISTRY_PATH);
        const defaultPath = resolve(DEFAULT_MODEL_GATEWAY_REGISTRY_PATH);
        const io = options.io ?? (filePath === defaultPath ? DEFAULT_MODEL_GATEWAY_REGISTRY_IO : null);
        if (!io) {
            throw new TypeError('Alternate model-gateway registry paths require already-authorized IO.');
        }
        this.#filePath = filePath;
        this.#storage = createBoundJsonStore({
            filePath,
            io,
            writeOptions: { durability: 'file-and-directory' },
        });
    }

    /** @returns {string} */
    get filePath() {
        return this.#filePath;
    }

    /**
     * @returns {Promise<{
     *     schemaVersion: number;
     *     generatedAt: string | null;
     *     source: string;
     *     providers: Record<string, unknown>[];
     *     models: Record<string, unknown>[];
     * }>}
     */
    async readSnapshot() {
        const raw = await this.#storage.read(null);
        return normalizeStoredRegistrySnapshot(raw);
    }

    /**
     * @returns {Promise<ModelGatewayRegistry>}
     */
    async loadRegistry() {
        const snapshot = await this.readSnapshot();
        const registry = new ModelGatewayRegistry();
        for (const provider of snapshot.providers) registry.upsertProvider(provider);
        for (const model of snapshot.models) registry.upsertModel(model);
        return registry;
    }

    /**
     * @param {{ source?: string; providers: Record<string, unknown>[]; models: Record<string, unknown>[] }} snapshot
     * @returns {Promise<void>}
     */
    async writeSnapshot(snapshot) {
        await this.#storage.write({
            schemaVersion: MODEL_GATEWAY_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            source: snapshot.source ?? 'registry',
            providers: snapshot.providers,
            models: snapshot.models,
        });
    }

    /**
     * @param {ModelGatewayRegistry} registry
     * @param {{ source?: string }} [options]
     * @returns {Promise<void>}
     */
    async saveRegistry(registry, options = {}) {
        await this.writeSnapshot({
            source: options.source ?? 'registry',
            ...registry.snapshot(),
        });
    }
}
