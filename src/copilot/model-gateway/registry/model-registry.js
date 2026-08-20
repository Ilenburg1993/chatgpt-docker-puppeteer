// @ts-check
/**
 * In-memory model gateway registry.
 *
 * The registry is the semantic validation boundary between dynamic/persisted records and canonical provider/model
 * records. Callers may submit unknown data; only values accepted and normalized by the canonical factories enter the
 * in-memory maps.
 *
 * @module copilot/model-gateway/registry/model-registry
 */

import {
    createModelRecord,
    createProviderRecord,
    optionalString,
} from '../contracts/records.js';
import { evaluateGatewayModelHealthRoute } from '../routing/index.js';

/** @typedef {ReturnType<typeof createProviderRecord>} ModelGatewayProviderRecord */
/** @typedef {ReturnType<typeof createModelRecord>} ModelGatewayModelRecord */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    return Array.isArray(value)
        ? value.map(optionalString).filter((item) => item !== null)
        : [];
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function stringRecord(value) {
    /** @type {Record<string, string>} */
    const result = {};
    if (!isRecord(value)) return result;
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string') result[key] = item;
    }
    return result;
}

/**
 * @param {unknown} value
 * @returns {Record<string, number | null | undefined>}
 */
function numericRecord(value) {
    /** @type {Record<string, number | null | undefined>} */
    const result = {};
    if (!isRecord(value)) return result;
    for (const [key, item] of Object.entries(value)) {
        if (item === null || typeof item === 'number') result[key] = item;
    }
    return result;
}

/**
 * @param {unknown} value
 * @returns {{ input?: string[]; output?: string[] }}
 */
function modalityInput(value) {
    if (!isRecord(value)) return {};
    const input = stringArray(value['input']);
    const output = stringArray(value['output']);
    return {
        ...(input.length > 0 ? { input } : {}),
        ...(output.length > 0 ? { output } : {}),
    };
}

/**
 * @param {unknown} value
 * @returns {Parameters<typeof createProviderRecord>[0]}
 */
function providerRecordInput(value) {
    if (!isRecord(value)) throw new TypeError('[model-gateway] provider record must be an object');
    const id = optionalString(value['id']);
    if (!id) throw new TypeError('[model-gateway] provider record id is required');
    return {
        id,
        ...(optionalString(value['displayName']) ? { displayName: optionalString(value['displayName']) ?? undefined } : {}),
        ...(optionalString(value['providerType']) ? { providerType: optionalString(value['providerType']) ?? undefined } : {}),
        ...(optionalString(value['baseUrl']) ? { baseUrl: optionalString(value['baseUrl']) ?? undefined } : {}),
        ...(optionalString(value['wireApi']) ? { wireApi: optionalString(value['wireApi']) ?? undefined } : {}),
        ...(typeof value['enabled'] === 'boolean' ? { enabled: value['enabled'] } : {}),
        ...(typeof value['configured'] === 'boolean' ? { configured: value['configured'] } : {}),
        secretRefs: stringArray(value['secretRefs']),
        headers: stringRecord(value['headers']),
        auth: isRecord(value['auth']) ? value['auth'] : {},
        provenance: isRecord(value['provenance']) ? value['provenance'] : {},
    };
}

/**
 * @param {unknown} value
 * @returns {Parameters<typeof createModelRecord>[0]}
 */
function modelRecordInput(value) {
    if (!isRecord(value)) throw new TypeError('[model-gateway] model record must be an object');
    const providerId = optionalString(value['providerId']);
    const providerModel = optionalString(value['providerModel']);
    if (!providerId) throw new TypeError('[model-gateway] model record providerId is required');
    if (!providerModel) throw new TypeError('[model-gateway] model record providerModel is required');
    const id = optionalString(value['id']);
    const displayName = optionalString(value['displayName']);
    return {
        providerId,
        providerModel,
        ...(id ? { id } : {}),
        ...(displayName ? { displayName } : {}),
        ...(typeof value['enabled'] === 'boolean' ? { enabled: value['enabled'] } : {}),
        modalities: modalityInput(value['modalities']),
        capabilities: isRecord(value['capabilities']) ? value['capabilities'] : {},
        supportedParameters: stringArray(value['supportedParameters']),
        limits: numericRecord(value['limits']),
        pricing: numericRecord(value['pricing']),
        routing: isRecord(value['routing']) ? value['routing'] : {},
        verification: isRecord(value['verification']) ? value['verification'] : {},
        provenance: isRecord(value['provenance']) ? value['provenance'] : {},
    };
}

export class ModelGatewayRegistry {
    /** @type {Map<string, ModelGatewayProviderRecord>} */
    #providers = new Map();
    /** @type {Map<string, ModelGatewayModelRecord>} */
    #models = new Map();

    /**
     * @param {unknown} record
     * @returns {ModelGatewayProviderRecord}
     */
    upsertProvider(record) {
        const normalized = createProviderRecord(providerRecordInput(record));
        this.#providers.set(normalized.id, normalized);
        return normalized;
    }

    /**
     * @param {unknown} record
     * @returns {ModelGatewayModelRecord}
     */
    upsertModel(record) {
        const normalized = createModelRecord(modelRecordInput(record));
        this.#models.set(normalized.id, normalized);
        return normalized;
    }

    /** @param {string} id @returns {ModelGatewayProviderRecord | null} */
    getProvider(id) {
        return this.#providers.get(id) ?? null;
    }

    /** @param {string} id @returns {ModelGatewayModelRecord | null} */
    getModel(id) {
        return this.#models.get(id) ?? null;
    }

    /** @returns {ModelGatewayProviderRecord[]} */
    listProviders() {
        return [...this.#providers.values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    /** @returns {ModelGatewayModelRecord[]} */
    listModels() {
        return [...this.#models.values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    /** @returns {ModelGatewayModelRecord[]} */
    listEnabledModels() {
        return this.listModels().filter((model) => model.enabled !== false);
    }

    /**
     * @param {{ providerId?: string; requires?: string[]; minContextWindowTokens?: number; health?: { routeProfile?: string | null; excludeFailed?: boolean; requireAgentProbeOk?: boolean } }} [requirements]
     * @returns {ModelGatewayModelRecord[]}
     */
    findCandidates(requirements = {}) {
        const requiredCapabilities = Array.isArray(requirements.requires) ? requirements.requires : [];
        return this.listEnabledModels().filter((model) => {
            if (requirements.providerId && model.providerId !== requirements.providerId) return false;
            if (typeof requirements.minContextWindowTokens === 'number') {
                const context = typeof model.limits['contextWindowTokens'] === 'number' ? model.limits['contextWindowTokens'] : 0;
                if (context < requirements.minContextWindowTokens) return false;
            }
            if (requirements.health) {
                const healthRoute = evaluateGatewayModelHealthRoute(model, requirements.health);
                if (!healthRoute.include) return false;
            }
            return requiredCapabilities.every((name) => model.capabilities[name] === true);
        });
    }

    /** @returns {{ providers: ModelGatewayProviderRecord[]; models: ModelGatewayModelRecord[] }} */
    snapshot() {
        return {
            providers: this.listProviders(),
            models: this.listModels(),
        };
    }
}
