// @ts-check
/**
 * Provider endpoint inventory.
 *
 * This is not a capability database. It records where metadata and runtime evidence can be collected so catalog
 * importers can start from provider-specific facts before the router applies policy.
 *
 * @module copilot/model-gateway/providers/endpoints
 */

import { ANTHROPIC_PROVIDER_ENDPOINTS } from './anthropic.js';
import { CEREBRAS_PROVIDER_ENDPOINTS } from './cerebras.js';
import { CHUTES_PROVIDER_ENDPOINTS } from './chutes.js';
import { CLOUDFLARE_WORKERS_AI_PROVIDER_ENDPOINTS } from './cloudflare-workers-ai.js';
import { GEMINI_PROVIDER_ENDPOINTS } from './gemini.js';
import { GROQ_PROVIDER_ENDPOINTS } from './groq.js';
import { HUGGINGFACE_PROVIDER_ENDPOINTS } from './huggingface.js';
import { KILO_PROVIDER_ENDPOINTS } from './kilo.js';
import { MISTRAL_PROVIDER_ENDPOINTS } from './mistral.js';
import { NVIDIA_NIM_PROVIDER_ENDPOINTS } from './nvidia-nim.js';
import { OLLAMA_PROVIDER_ENDPOINTS } from './ollama.js';
import { OPENAI_PROVIDER_ENDPOINTS } from './openai.js';
import { OPENCODE_PROVIDER_ENDPOINTS } from './opencode.js';
import { OPENROUTER_PROVIDER_ENDPOINTS } from './openrouter.js';
import { ZAI_PROVIDER_ENDPOINTS } from './zai.js';
export {
    auditProviderEndpointImporterCoverage,
    listProviderEndpointSourceRecords,
    MODEL_GATEWAY_ENDPOINT_RICHNESS_CATEGORIES,
    normalizeProviderEndpointRichness,
} from './source-records.js';

/**
 * @typedef {object} ProviderEndpointSource
 * @property {string} kind
 * @property {string} method
 * @property {string} url
 * @property {string} richness
 */

/**
 * @typedef {object} ProviderRuntimeEndpoint
 * @property {string} kind
 * @property {string} method
 * @property {string} path
 */

/**
 * @typedef {object} ProviderEndpointInventory
 * @property {string} providerId
 * @property {readonly string[]} [providerAliases]
 * @property {string} adapterId
 * @property {string} providerKind
 * @property {readonly string[]} baseUrls
 * @property {readonly ProviderEndpointSource[]} modelCatalogSources
 * @property {readonly ProviderRuntimeEndpoint[]} runtimeEndpoints
 * @property {readonly string[]} routeSelectors
 */

/** @type {readonly ProviderEndpointInventory[]} */
export const MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY = Object.freeze([
    OPENAI_PROVIDER_ENDPOINTS,
    OPENROUTER_PROVIDER_ENDPOINTS,
    ANTHROPIC_PROVIDER_ENDPOINTS,
    GEMINI_PROVIDER_ENDPOINTS,
    OLLAMA_PROVIDER_ENDPOINTS,
    KILO_PROVIDER_ENDPOINTS,
    GROQ_PROVIDER_ENDPOINTS,
    MISTRAL_PROVIDER_ENDPOINTS,
    HUGGINGFACE_PROVIDER_ENDPOINTS,
    CLOUDFLARE_WORKERS_AI_PROVIDER_ENDPOINTS,
    NVIDIA_NIM_PROVIDER_ENDPOINTS,
    OPENCODE_PROVIDER_ENDPOINTS,
    CEREBRAS_PROVIDER_ENDPOINTS,
    CHUTES_PROVIDER_ENDPOINTS,
    ZAI_PROVIDER_ENDPOINTS,
]);

/** @returns {readonly ProviderEndpointInventory[]} */
export function listProviderEndpointInventory() {
    return MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY;
}

/**
 * @param {string | null | undefined} providerId
 * @returns {ProviderEndpointInventory | null}
 */
export function resolveProviderEndpointInventory(providerId) {
    if (typeof providerId !== 'string') return null;
    const normalized = providerId.trim().toLowerCase();
    return (
        MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY.find(
            (item) =>
                item.providerId === normalized ||
                item.adapterId === normalized ||
                (Array.isArray(item.providerAliases) && item.providerAliases.includes(normalized)),
        ) ?? null
    );
}

export {
    ANTHROPIC_PROVIDER_ENDPOINTS,
    CEREBRAS_PROVIDER_ENDPOINTS,
    CHUTES_PROVIDER_ENDPOINTS,
    CLOUDFLARE_WORKERS_AI_PROVIDER_ENDPOINTS,
    GEMINI_PROVIDER_ENDPOINTS,
    GROQ_PROVIDER_ENDPOINTS,
    HUGGINGFACE_PROVIDER_ENDPOINTS,
    KILO_PROVIDER_ENDPOINTS,
    MISTRAL_PROVIDER_ENDPOINTS,
    NVIDIA_NIM_PROVIDER_ENDPOINTS,
    OLLAMA_PROVIDER_ENDPOINTS,
    OPENAI_PROVIDER_ENDPOINTS,
    OPENCODE_PROVIDER_ENDPOINTS,
    OPENROUTER_PROVIDER_ENDPOINTS,
    ZAI_PROVIDER_ENDPOINTS,
};
