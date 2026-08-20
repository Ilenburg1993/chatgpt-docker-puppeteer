// @ts-check
/**
 * OpenAI-compatible model catalog projection.
 *
 * Internally the gateway keeps universal, provider-rich metadata. Externally we normalize the model surface to the
 * OpenAI Models API shape and carry gateway-specific metadata in a namespaced extension.
 *
 * @module copilot/model-gateway/catalog/openai-schema
 */

import { explainModelGatewayEligibilityDecision } from '../eligibility/index.js';
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
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
 * @param {Record<string, unknown>} projection
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
 * @param {Record<string, unknown>} projection
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
 * @param {Record<string, unknown>} projection
 * @returns {string | null}
 */
function readSubjectProviderId(projection) {
    const providerMetadata = isRecord(projection['providerMetadata']) ? projection['providerMetadata'] : {};
    const kilo = isRecord(providerMetadata['kilo']) ? providerMetadata['kilo'] : {};
    return typeof kilo['upstreamProvider'] === 'string' && kilo['upstreamProvider']
        ? kilo['upstreamProvider']
        : typeof providerMetadata['ownedBy'] === 'string' && providerMetadata['ownedBy']
          ? providerMetadata['ownedBy']
          : typeof providerMetadata['owned_by'] === 'string' && providerMetadata['owned_by']
            ? providerMetadata['owned_by']
            : typeof projection['providerId'] === 'string'
              ? projection['providerId']
              : null;
}

/**
 * @param {Record<string, unknown> | null} providerProjection
 */
function buildProviderProjectionExtension(providerProjection) {
    if (!providerProjection) return null;
    return {
        provider_id: providerProjection['providerId'] ?? null,
        subject_provider_id: providerProjection['subjectProviderId'] ?? null,
        display_name: providerProjection['displayName'] ?? providerProjection['subjectProviderId'] ?? null,
        data_policy: providerProjection['dataPolicy'] ?? {},
        provider_metadata: providerProjection['providerMetadata'] ?? {},
        provenance_by_field: providerProjection['provenanceByField'] ?? {},
        confidence_by_field: providerProjection['confidenceByField'] ?? {},
    };
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} providerProjections
 * @returns {Record<string, unknown> | null}
 */
function findProviderProjection(projection, providerProjections) {
    const providerId = typeof projection['providerId'] === 'string' ? projection['providerId'] : null;
    const subjectProviderId = readSubjectProviderId(projection);
    if (!providerId || !subjectProviderId) return null;
    return (
        providerProjections.find(
            (candidate) =>
                candidate['providerId'] === providerId && candidate['subjectProviderId'] === subjectProviderId,
        ) ?? null
    );
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} eligibilityDecisions
 * @returns {Record<string, unknown> | null}
 */
function findEligibilityDecision(projection, eligibilityDecisions) {
    const providerId = typeof projection['providerId'] === 'string' ? projection['providerId'] : null;
    const providerModel = typeof projection['providerModel'] === 'string' ? projection['providerModel'] : null;
    const routeProfile = optionalString(projection['routeProfile']);
    if (!providerId || !providerModel) return null;
    return (
        eligibilityDecisions.find(
            (decision) =>
                decision['providerId'] === providerId &&
                decision['providerModel'] === providerModel &&
                (decision['routeProfile'] ?? null) === routeProfile,
        ) ?? null
    );
}

/**
 * @param {Record<string, unknown> | null} decision
 */
function buildEligibilityExtension(decision) {
    if (!decision) return null;
    const explanation = explainModelGatewayEligibilityDecision(decision);
    return {
        include: explanation.include,
        status: explanation.status,
        disposition: explanation.disposition,
        primary_reason: explanation.primaryReason,
        hard_exclusions: explanation.hardExclusions,
        soft_penalties: explanation.softPenalties,
        required_runtime_probes: explanation.requiredRuntimeProbes,
        next_actions: explanation.nextActions,
    };
}

/**
 * @param {Record<string, unknown>} projection
 * @param {Record<string, unknown>[]} routeOptions
 * @returns {Record<string, unknown>[]}
 */
function findRouteOptions(projection, routeOptions) {
    const providerId = optionalString(projection['providerId']);
    const providerModel = optionalString(projection['providerModel']);
    const routeProfile = optionalString(projection['routeProfile']);
    if (!providerId || !providerModel) return [];
    return routeOptions.filter(
        (route) =>
            optionalString(route['providerId']) === providerId &&
            optionalString(route['providerModel']) === providerModel &&
            optionalString(route['routeProfile']) === routeProfile,
    );
}

/**
 * @param {Record<string, unknown>} route
 */
function buildRouteOptionExtension(route) {
    const normalizedPolicy = isRecord(route['normalizedPolicy']) ? route['normalizedPolicy'] : {};
    return {
        provider_id: route['providerId'] ?? null,
        provider_model: route['providerModel'] ?? null,
        route_profile: route['routeProfile'] ?? null,
        selector_kind: route['selectorKind'] ?? null,
        selector_syntax: route['selectorSyntax'] ?? null,
        source_id: route['sourceId'] ?? null,
        source_kind: route['sourceKind'] ?? null,
        confidence: route['confidence'] ?? null,
        normalized_policy: normalizedPolicy,
        route_traits: isRecord(normalizedPolicy['routeTraits']) ? normalizedPolicy['routeTraits'] : {},
        provider_specific: isRecord(route['providerSpecific']) ? route['providerSpecific'] : {},
    };
}

/**
 * @param {Record<string, unknown>} projection
 * @param {{
 *     providerProjections?: Record<string, unknown>[];
 *     eligibilityDecisions?: Record<string, unknown>[];
 *     routeOptions?: Record<string, unknown>[];
 * }} [options]
 */
function buildGatewayExtension(projection, options = {}) {
    const providerProjection = findProviderProjection(projection, options.providerProjections ?? []);
    const eligibility = findEligibilityDecision(projection, options.eligibilityDecisions ?? []);
    const routeOptions = findRouteOptions(projection, options.routeOptions ?? []);
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
        provider_projection: buildProviderProjectionExtension(providerProjection),
        route_options: routeOptions.map(buildRouteOptionExtension),
        eligibility: buildEligibilityExtension(eligibility),
        routing_hints: projection['routingHints'] ?? {},
        account_overlay_refs: projection['accountOverlayRefs'] ?? [],
        provenance_by_field: projection['provenanceByField'] ?? {},
        confidence_by_field: projection['confidenceByField'] ?? {},
    };
}

/**
 * @param {Record<string, unknown>} projection
 * @param {{
 *     providerProjections?: Record<string, unknown>[];
 *     eligibilityDecisions?: Record<string, unknown>[];
 *     routeOptions?: Record<string, unknown>[];
 * }} [options]
 */
export function toOpenAIModelCatalogEntry(projection, options = {}) {
    const openai = isRecord(projection['openai']) ? projection['openai'] : {};
    return {
        id: String(openai['id'] ?? projection['providerModel'] ?? projection['id'] ?? 'unknown'),
        object: OPENAI_MODEL_OBJECT,
        created: readCreated(projection),
        owned_by: readOwnedBy(projection),
        x_model_gateway: buildGatewayExtension(projection, options),
    };
}

/**
 * @param {Record<string, unknown>[]} projections
 * @param {{
 *     providerProjections?: Record<string, unknown>[];
 *     eligibilityDecisions?: Record<string, unknown>[];
 *     routeOptions?: Record<string, unknown>[];
 * }} [options]
 * @returns {{ object: 'list'; data: ReturnType<typeof toOpenAIModelCatalogEntry>[] }}
 */
export function toOpenAIModelCatalogList(projections, options = {}) {
    return {
        object: OPENAI_MODEL_LIST_OBJECT,
        data: projections.map((projection) => toOpenAIModelCatalogEntry(projection, options)),
    };
}
