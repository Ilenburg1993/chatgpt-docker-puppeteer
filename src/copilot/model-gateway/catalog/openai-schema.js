// @ts-check
/**
 * OpenAI-compatible model catalog projection.
 *
 * Internally the gateway keeps universal, provider-rich metadata. Externally we normalize the model surface to the
 * OpenAI Models API shape and carry gateway-specific metadata in a namespaced extension.
 *
 * @module copilot/model-gateway/catalog/openai-schema
 */

import { MODEL_GATEWAY_CATALOG_SCHEMA_VERSION } from './contracts.js';

export const OPENAI_MODEL_OBJECT = 'model';
export const OPENAI_MODEL_LIST_OBJECT = 'list';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function unixSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsedNumber = Number(value);
        if (Number.isFinite(parsedNumber)) return Math.trunc(parsedNumber);
        const parsedDate = Date.parse(value);
        return Number.isFinite(parsedDate) ? Math.trunc(parsedDate / 1000) : null;
    }
    return null;
}

/**
 * @param {Record<string, any>} projection
 * @returns {number | null}
 */
function readCreated(projection) {
    const openai = isRecord(projection['openai']) ? projection['openai'] : {};
    const lifecycle = isRecord(projection['lifecycle']) ? projection['lifecycle'] : {};
    return (
        unixSeconds(openai['created']) ??
        unixSeconds(openai['created_at']) ??
        unixSeconds(lifecycle['createdAt']) ??
        unixSeconds(lifecycle['created_at']) ??
        null
    );
}

/**
 * @param {Record<string, any>} projection
 * @returns {string}
 */
function readOwnedBy(projection) {
    const providerMetadata = isRecord(projection['providerMetadata']) ? projection['providerMetadata'] : {};
    const openai = isRecord(projection['openai']) ? projection['openai'] : {};
    return String(
        openai['owned_by'] ??
            openai['ownedBy'] ??
            providerMetadata['owned_by'] ??
            providerMetadata['ownedBy'] ??
            projection['providerId'] ??
            'unknown',
    );
}

/**
 * @param {Record<string, any>} projection
 * @returns {Record<string, unknown>}
 */
function buildGatewayExtension(projection) {
    return {
        schema_version: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        gateway_id: `${projection['providerId'] ?? 'unknown'}:${projection['providerModel'] ?? projection['id'] ?? 'unknown'}`,
        provider_id: projection['providerId'] ?? null,
        provider_model: projection['providerModel'] ?? projection['id'] ?? null,
        route_profile: projection['routeProfile'] ?? null,
        display_name: projection['displayName'] ?? projection['providerModel'] ?? projection['id'] ?? null,
        description: projection['description'] ?? null,
        lifecycle: projection['lifecycle'] ?? 'unknown',
        aliases: projection['aliases'] ?? [],
        family: projection['family'] ?? null,
        modalities: projection['modalities'] ?? { input: ['text'], output: ['text'] },
        capabilities: projection['capabilities'] ?? {},
        supported_parameters: projection['supportedParameters'] ?? [],
        unsupported_parameters: projection['unsupportedParameters'] ?? [],
        limits: projection['limits'] ?? {},
        pricing: projection['pricing'] ?? {},
        rate_limits: projection['rateLimits'] ?? {},
        data_policy: projection['dataPolicy'] ?? {},
        license: projection['license'] ?? null,
        provider_metadata: projection['providerMetadata'] ?? {},
        routing_hints: projection['routingHints'] ?? {},
        account_overlay_refs: projection['accountOverlayRefs'] ?? [],
        provenance_by_field: projection['provenanceByField'] ?? {},
        confidence_by_field: projection['confidenceByField'] ?? {},
    };
}

/**
 * @param {Record<string, any>} projection
 * @returns {{ id: string; object: 'model'; created: number | null; owned_by: string; x_model_gateway: Record<string, unknown> }}
 */
export function toOpenAIModelCatalogEntry(projection) {
    const openai = isRecord(projection['openai']) ? projection['openai'] : {};
    return {
        id: String(openai['id'] ?? projection['providerModel'] ?? projection['id'] ?? 'unknown'),
        object: OPENAI_MODEL_OBJECT,
        created: readCreated(projection),
        owned_by: readOwnedBy(projection),
        x_model_gateway: buildGatewayExtension(projection),
    };
}

/**
 * @param {Record<string, any>[]} projections
 * @returns {{ object: 'list'; data: ReturnType<typeof toOpenAIModelCatalogEntry>[] }}
 */
export function toOpenAIModelCatalogList(projections) {
    return {
        object: OPENAI_MODEL_LIST_OBJECT,
        data: projections.map(toOpenAIModelCatalogEntry),
    };
}

