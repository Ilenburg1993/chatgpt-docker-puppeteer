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
import { explainModelGatewayEligibilityDecision } from '../eligibility/index.js';

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
 * @param {Record<string, any> | null} providerProjection
 * @returns {Record<string, unknown> | null}
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
 * @param {Record<string, any>} projection
 * @param {Record<string, any>[]} providerProjections
 * @returns {Record<string, any> | null}
 */
function findProviderProjection(projection, providerProjections) {
    const providerId = typeof projection['providerId'] === 'string' ? projection['providerId'] : null;
    const subjectProviderId = readSubjectProviderId(projection);
    if (!providerId || !subjectProviderId) return null;
    return (
        providerProjections.find(
            (candidate) => candidate['providerId'] === providerId && candidate['subjectProviderId'] === subjectProviderId,
        ) ?? null
    );
}

/**
 * @param {Record<string, any>} projection
 * @param {Record<string, any>[]} eligibilityDecisions
 * @returns {Record<string, any> | null}
 */
function findEligibilityDecision(projection, eligibilityDecisions) {
    const providerId = typeof projection['providerId'] === 'string' ? projection['providerId'] : null;
    const providerModel = typeof projection['providerModel'] === 'string' ? projection['providerModel'] : null;
    const routeProfile = typeof projection['routeProfile'] === 'string' && projection['routeProfile'] ? projection['routeProfile'] : null;
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
 * @param {Record<string, any> | null} decision
 * @returns {Record<string, unknown> | null}
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
 * @param {Record<string, any>} projection
 * @param {{ providerProjections?: Record<string, any>[]; eligibilityDecisions?: Record<string, any>[] }} [options]
 * @returns {Record<string, unknown>}
 */
function buildGatewayExtension(projection, options = {}) {
    const providerProjection = findProviderProjection(projection, options.providerProjections ?? []);
    const eligibility = findEligibilityDecision(projection, options.eligibilityDecisions ?? []);
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
        eligibility: buildEligibilityExtension(eligibility),
        routing_hints: projection['routingHints'] ?? {},
        account_overlay_refs: projection['accountOverlayRefs'] ?? [],
        provenance_by_field: projection['provenanceByField'] ?? {},
        confidence_by_field: projection['confidenceByField'] ?? {},
    };
}

/**
 * @param {Record<string, any>} projection
 * @param {{ providerProjections?: Record<string, any>[]; eligibilityDecisions?: Record<string, any>[] }} [options]
 * @returns {{ id: string; object: 'model'; created: number | null; owned_by: string; x_model_gateway: Record<string, unknown> }}
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
 * @param {Record<string, any>[]} projections
 * @param {{ providerProjections?: Record<string, any>[]; eligibilityDecisions?: Record<string, any>[] }} [options]
 * @returns {{ object: 'list'; data: ReturnType<typeof toOpenAIModelCatalogEntry>[] }}
 */
export function toOpenAIModelCatalogList(projections, options = {}) {
    return {
        object: OPENAI_MODEL_LIST_OBJECT,
        data: projections.map((projection) => toOpenAIModelCatalogEntry(projection, options)),
    };
}
