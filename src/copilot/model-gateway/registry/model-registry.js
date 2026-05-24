// @ts-check
/**
 * In-memory model gateway registry.
 *
 * This is intentionally small: persistence and remote catalog sync can be added behind the same API without changing
 * terminal or SDK callers.
 *
 * @module copilot/model-gateway/registry/model-registry
 */

import { createModelRecord, createProviderRecord } from '../contracts/records.js';

export class ModelGatewayRegistry {
    /** @type {Map<string, Record<string, any>>} */
    #providers = new Map();
    /** @type {Map<string, Record<string, any>>} */
    #models = new Map();

    /**
     * @param {Record<string, any>} record
     * @returns {Record<string, any>}
     */
    upsertProvider(record) {
        const normalized = /** @type {Record<string, any>} */ (createProviderRecord(/** @type {any} */ (record)));
        this.#providers.set(/** @type {string} */ (normalized['id']), normalized);
        return normalized;
    }

    /**
     * @param {Record<string, any>} record
     * @returns {Record<string, any>}
     */
    upsertModel(record) {
        const normalized = /** @type {Record<string, any>} */ (createModelRecord(/** @type {any} */ (record)));
        this.#models.set(/** @type {string} */ (normalized['id']), normalized);
        return normalized;
    }

    /**
     * @param {string} id
     * @returns {Record<string, any> | null}
     */
    getProvider(id) {
        return this.#providers.get(id) ?? null;
    }

    /**
     * @param {string} id
     * @returns {Record<string, any> | null}
     */
    getModel(id) {
        return this.#models.get(id) ?? null;
    }

    /** @returns {Record<string, any>[]} */
    listProviders() {
        return [...this.#providers.values()].sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
    }

    /** @returns {Record<string, any>[]} */
    listModels() {
        return [...this.#models.values()].sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
    }

    /** @returns {Record<string, any>[]} */
    listEnabledModels() {
        return this.listModels().filter((model) => model['enabled'] !== false);
    }

    /**
     * @param {{ providerId?: string; requires?: string[]; minContextWindowTokens?: number }} [requirements]
     * @returns {Record<string, any>[]}
     */
    findCandidates(requirements = {}) {
        const requiredCapabilities = Array.isArray(requirements.requires) ? requirements.requires : [];
        return this.listEnabledModels().filter((model) => {
            if (requirements.providerId && model['providerId'] !== requirements.providerId) return false;
            if (typeof requirements.minContextWindowTokens === 'number') {
                const context = typeof model['limits']?.contextWindowTokens === 'number' ? model['limits'].contextWindowTokens : 0;
                if (context < requirements.minContextWindowTokens) return false;
            }
            return requiredCapabilities.every((name) => model['capabilities']?.[name] === true);
        });
    }

    /** @returns {{ providers: Record<string, any>[]; models: Record<string, any>[] }} */
    snapshot() {
        return {
            providers: this.listProviders(),
            models: this.listModels(),
        };
    }
}
