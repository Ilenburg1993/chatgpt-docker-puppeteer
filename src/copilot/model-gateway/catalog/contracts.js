// @ts-check
/**
 * Universal catalog/evidence contracts for the model gateway.
 *
 * These records are intentionally pure JSON and secret-safe. They are the first durable vocabulary for Faixa K before
 * SQLite storage, import runs and provider-specific parsers exist.
 *
 * @module copilot/model-gateway/catalog/contracts
 */

import { normalizeGatewayIdPart, optionalPositiveInteger, optionalString } from '../contracts/index.js';
import { redactSecretRecord, redactSecretText } from '../secrets/index.js';

export const MODEL_GATEWAY_CATALOG_SCHEMA_VERSION = 1;

export const MODEL_GATEWAY_CATALOG_CONFIDENCE = Object.freeze({
    UNKNOWN: 'unknown',
    HEURISTIC: 'heuristic',
    STATIC_SEED: 'static_seed',
    CATALOG: 'catalog',
    DOCS: 'docs',
    AUTHENTICATED_CATALOG: 'authenticated_catalog',
    MANUAL: 'manual',
    PROBE_VERIFIED: 'probe_verified',
    PROBE_FAILED: 'probe_failed',
});

const CATALOG_SOURCE_DEFAULTS = Object.freeze({
    kind: 'manual',
    authMode: 'none',
    refreshPolicy: 'manual',
    trustTier: 'unknown',
});

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
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeJsonValue(value) {
    if (typeof value === 'string') return redactSecretText(value);
    if (Array.isArray(value)) return value.map(sanitizeJsonValue);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                /^(?:authorization|proxy-authorization|api[_-]?key|secret|token|bearer[_-]?token|access[_-]?token)$/iu.test(key)
                    ? '[redacted]'
                    : sanitizeJsonValue(item),
            ]),
        );
    }
    if (value === undefined) return null;
    return value;
}

/**
 * @param {unknown} providerId
 * @returns {string}
 */
function normalizeProviderId(providerId) {
    const id = optionalString(providerId);
    const normalized = id ? normalizeGatewayIdPart(id) : '';
    if (!normalized) throw new Error('[model-gateway/catalog] providerId is required');
    return normalized;
}

/**
 * @param {object} input
 * @param {string} input.id
 * @param {string} input.providerId
 * @param {string} [input.kind]
 * @param {string} [input.url]
 * @param {string} [input.command]
 * @param {string[]} [input.envRequirements]
 * @param {string} [input.authMode]
 * @param {string} [input.refreshPolicy]
 * @param {number} [input.ttlSeconds]
 * @param {string} [input.parserId]
 * @param {string} [input.trustTier]
 * @returns {object}
 */
export function createProviderCatalogSource(input) {
    const id = optionalString(input.id);
    if (!id) throw new Error('[model-gateway/catalog] source id is required');
    const now = new Date().toISOString();
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        id,
        providerId: normalizeProviderId(input.providerId),
        kind: optionalString(input.kind) ?? CATALOG_SOURCE_DEFAULTS.kind,
        url: optionalString(input.url),
        command: optionalString(input.command),
        envRequirements: stringList(input.envRequirements),
        authMode: optionalString(input.authMode) ?? CATALOG_SOURCE_DEFAULTS.authMode,
        refreshPolicy: optionalString(input.refreshPolicy) ?? CATALOG_SOURCE_DEFAULTS.refreshPolicy,
        ttlSeconds: optionalPositiveInteger(input.ttlSeconds),
        parserId: optionalString(input.parserId) ?? id,
        trustTier: optionalString(input.trustTier) ?? CATALOG_SOURCE_DEFAULTS.trustTier,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * @param {object} input
 * @param {string} input.evidenceId
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string} [input.routeProfile]
 * @param {string} input.fieldPath
 * @param {unknown} input.value
 * @param {unknown} [input.normalizedValue]
 * @param {string} input.sourceId
 * @param {string} [input.sourceKind]
 * @param {string} [input.confidence]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 * @param {string} [input.rawPayloadRef]
 * @returns {object}
 */
export function createModelMetadataEvidence(input) {
    const evidenceId = optionalString(input.evidenceId);
    const providerModel = optionalString(input.providerModel);
    const fieldPath = optionalString(input.fieldPath);
    const sourceId = optionalString(input.sourceId);
    if (!evidenceId) throw new Error('[model-gateway/catalog] evidenceId is required');
    if (!providerModel) throw new Error('[model-gateway/catalog] providerModel is required');
    if (!fieldPath) throw new Error('[model-gateway/catalog] fieldPath is required');
    if (!sourceId) throw new Error('[model-gateway/catalog] sourceId is required');
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        evidenceId,
        providerId: normalizeProviderId(input.providerId),
        providerModel,
        routeProfile: optionalString(input.routeProfile),
        fieldPath,
        value: sanitizeJsonValue(input.value),
        normalizedValue: sanitizeJsonValue(input.normalizedValue ?? input.value),
        sourceId,
        sourceKind: optionalString(input.sourceKind) ?? 'unknown',
        confidence: optionalString(input.confidence) ?? MODEL_GATEWAY_CATALOG_CONFIDENCE.UNKNOWN,
        observedAt: normalizeIsoDate(input.observedAt) ?? new Date().toISOString(),
        expiresAt: normalizeIsoDate(input.expiresAt),
        rawPayloadRef: optionalString(input.rawPayloadRef),
        redactionStatus: 'sanitized',
    };
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string} [input.routeProfile]
 * @param {string} [input.selectorKind]
 * @param {string} [input.selectorSyntax]
 * @param {Record<string, unknown>} [input.providerSpecific]
 * @param {Record<string, unknown>} [input.normalizedPolicy]
 * @returns {object}
 */
export function createModelRouteOption(input) {
    const providerModel = optionalString(input.providerModel);
    if (!providerModel) throw new Error('[model-gateway/catalog] route providerModel is required');
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        providerId: normalizeProviderId(input.providerId),
        providerModel,
        routeProfile: optionalString(input.routeProfile),
        selectorKind: optionalString(input.selectorKind) ?? 'exact_model',
        selectorSyntax: optionalString(input.selectorSyntax) ?? providerModel,
        providerSpecific: isRecord(input.providerSpecific) ? sanitizeJsonValue(input.providerSpecific) : {},
        normalizedPolicy: isRecord(input.normalizedPolicy) ? sanitizeJsonValue(input.normalizedPolicy) : {},
    };
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} [input.accountOverlayId]
 * @param {string} [input.accountScope]
 * @param {string} [input.secretRef]
 * @param {string} [input.organizationIdRef]
 * @param {string} [input.sourceId]
 * @param {string} [input.sourceKind]
 * @param {string} [input.confidence]
 * @param {string[]} [input.enabledModels]
 * @param {string[]} [input.blockedModels]
 * @param {string[]} [input.byokProviderKeys]
 * @param {Record<string, unknown>} [input.quota]
 * @param {Record<string, unknown>} [input.rateLimits]
 * @param {Record<string, unknown>} [input.spendingLimits]
 * @param {Record<string, unknown>} [input.policyHeaders]
 * @param {Record<string, unknown>} [input.providerMetadata]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 * @returns {object}
 */
export function createProviderAccountOverlay(input) {
    const providerId = normalizeProviderId(input.providerId);
    const accountScope = optionalString(input.accountScope) ?? 'default';
    const secretRef = optionalString(input.secretRef);
    const sourceId = optionalString(input.sourceId);
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        accountOverlayId:
            optionalString(input.accountOverlayId) ??
            [providerId, accountScope, secretRef, sourceId].filter(Boolean).join(':'),
        providerId,
        accountScope,
        secretRef,
        organizationIdRef: optionalString(input.organizationIdRef),
        sourceId,
        sourceKind: optionalString(input.sourceKind) ?? 'unknown',
        confidence: optionalString(input.confidence) ?? MODEL_GATEWAY_CATALOG_CONFIDENCE.UNKNOWN,
        enabledModels: stringList(input.enabledModels),
        blockedModels: stringList(input.blockedModels),
        byokProviderKeys: stringList(input.byokProviderKeys),
        quota: isRecord(input.quota) ? sanitizeJsonValue(input.quota) : {},
        rateLimits: isRecord(input.rateLimits) ? sanitizeJsonValue(input.rateLimits) : {},
        spendingLimits: isRecord(input.spendingLimits) ? sanitizeJsonValue(input.spendingLimits) : {},
        policyHeaders: isRecord(input.policyHeaders) ? redactSecretRecord(input.policyHeaders) : {},
        providerMetadata: isRecord(input.providerMetadata) ? sanitizeJsonValue(input.providerMetadata) : {},
        observedAt: normalizeIsoDate(input.observedAt) ?? new Date().toISOString(),
        expiresAt: normalizeIsoDate(input.expiresAt),
        redactionStatus: 'sanitized',
    };
}

/**
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string} [input.routeProfile]
 * @param {string} [input.displayName]
 * @param {string} [input.description]
 * @param {string | Record<string, unknown>} [input.lifecycle]
 * @param {string[] | Record<string, unknown>} [input.aliases]
 * @param {string} [input.family]
 * @param {{ input?: string[]; output?: string[] }} [input.modalities]
 * @param {Record<string, unknown>} [input.capabilities]
 * @param {string[]} [input.supportedParameters]
 * @param {string[]} [input.unsupportedParameters]
 * @param {Record<string, unknown>} [input.limits]
 * @param {Record<string, unknown>} [input.pricing]
 * @param {Record<string, unknown>} [input.rateLimits]
 * @param {Record<string, unknown>} [input.dataPolicy]
 * @param {string} [input.license]
 * @param {Record<string, unknown>} [input.providerMetadata]
 * @param {Record<string, unknown>} [input.openai]
 * @param {Record<string, unknown>} [input.provenanceByField]
 * @param {Record<string, unknown>} [input.confidenceByField]
 * @param {Record<string, unknown>} [input.routingHints]
 * @param {string[]} [input.accountOverlayRefs]
 * @returns {object}
 */
export function createCanonicalModelProjection(input) {
    const providerModel = optionalString(input.providerModel);
    if (!providerModel) throw new Error('[model-gateway/catalog] projection providerModel is required');
    const lifecycleText = optionalString(input.lifecycle);
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        providerId: normalizeProviderId(input.providerId),
        providerModel,
        routeProfile: optionalString(input.routeProfile),
        displayName: optionalString(input.displayName) ?? providerModel,
        description: optionalString(input.description),
        lifecycle: lifecycleText ?? (isRecord(input.lifecycle) ? sanitizeJsonValue(input.lifecycle) : 'unknown'),
        aliases: Array.isArray(input.aliases)
            ? stringList(input.aliases)
            : isRecord(input.aliases)
              ? sanitizeJsonValue(input.aliases)
              : [],
        family: optionalString(input.family),
        modalities: {
            input: stringList(input.modalities?.input).length > 0 ? stringList(input.modalities?.input) : ['text'],
            output: stringList(input.modalities?.output).length > 0 ? stringList(input.modalities?.output) : ['text'],
        },
        capabilities: isRecord(input.capabilities) ? { ...input.capabilities } : {},
        supportedParameters: stringList(input.supportedParameters),
        unsupportedParameters: stringList(input.unsupportedParameters),
        limits: isRecord(input.limits) ? sanitizeJsonValue(input.limits) : {},
        pricing: isRecord(input.pricing) ? sanitizeJsonValue(input.pricing) : {},
        rateLimits: isRecord(input.rateLimits) ? sanitizeJsonValue(input.rateLimits) : {},
        dataPolicy: isRecord(input.dataPolicy) ? sanitizeJsonValue(input.dataPolicy) : {},
        license: optionalString(input.license),
        providerMetadata: isRecord(input.providerMetadata) ? sanitizeJsonValue(input.providerMetadata) : {},
        openai: isRecord(input.openai) ? sanitizeJsonValue(input.openai) : {},
        provenanceByField: isRecord(input.provenanceByField) ? sanitizeJsonValue(input.provenanceByField) : {},
        confidenceByField: isRecord(input.confidenceByField) ? sanitizeJsonValue(input.confidenceByField) : {},
        routingHints: isRecord(input.routingHints) ? sanitizeJsonValue(input.routingHints) : {},
        accountOverlayRefs: stringList(input.accountOverlayRefs),
    };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeIsoDate(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
