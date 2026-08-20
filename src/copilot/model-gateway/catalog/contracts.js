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
import { sanitizeJsonRecord, sanitizeJsonValue } from '../contracts/sanitized-json.js';
import { redactModelGatewayAuditedValue, redactSecretRecord } from '../secrets/index.js';
import { normalizeModelRoutePolicyTraits } from './normalizers.js';

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
const CATALOG_IDENTITY_SECRET_RE =
    /\b(?:hf_[A-Za-z0-9]{20,}|(?:(?:sk-(?:or-v1-)?|gsk[-_]|csk-|nvapi-|cpk[-_]|cfat[-_]|AIza|ya29\.|xoxb-|pat_|ghp_)[A-Za-z0-9._~+/=-]{8,}))\b/gu;

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
 * @param {string} value
 * @returns {string}
 */
function sanitizeCatalogString(value) {
    return String(redactModelGatewayAuditedValue(value));
}

/**
 * @template {Record<string, unknown>} T
 * @param {T | undefined} value
 * @returns {Record<string, unknown> & Partial<import('../contracts/sanitized-json.js').SanitizedRecord<T>>}
 */
function sanitizeOptionalCatalogRecord(value) {
    return /** @type {Record<string, unknown> & Partial<import('../contracts/sanitized-json.js').SanitizedRecord<T>>} */ (
        isRecord(value) ? sanitizeJsonRecord(value, sanitizeCatalogString) : {}
    );
}

/**
 * @param {string | null} value
 * @param {string | null} fallback
 * @returns {string | null}
 */
function sanitizeCatalogIdentity(value, fallback) {
    if (!value) return fallback;
    const redacted = value.replace(CATALOG_IDENTITY_SECRET_RE, '[redacted]');
    return redacted.includes('[redacted]') ? fallback : redacted;
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
 * @param {string | undefined} [input.kind]
 * @param {string | undefined} [input.url]
 * @param {string | undefined} [input.command]
 * @param {string[] | undefined} [input.envRequirements]
 * @param {string | undefined} [input.authMode]
 * @param {string | undefined} [input.refreshPolicy]
 * @param {number | undefined} [input.ttlSeconds]
 * @param {string | undefined} [input.parserId]
 * @param {string | undefined} [input.trustTier]
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
 * @param {string | undefined} [input.sourceKind]
 * @param {string | undefined} [input.confidence]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 * @param {string} [input.rawPayloadRef]
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
        value: sanitizeJsonValue(input.value, sanitizeCatalogString),
        normalizedValue: sanitizeJsonValue(input.normalizedValue ?? input.value, sanitizeCatalogString),
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
 * @param {string} input.evidenceId
 * @param {string} input.providerId
 * @param {string} input.subjectProviderId
 * @param {string} input.fieldPath
 * @param {unknown} input.value
 * @param {unknown} [input.normalizedValue]
 * @param {string} input.sourceId
 * @param {string | undefined} [input.sourceKind]
 * @param {string | undefined} [input.confidence]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 * @param {string} [input.rawPayloadRef]
 */
export function createProviderMetadataEvidence(input) {
    const evidenceId = optionalString(input.evidenceId);
    const subjectProviderId = optionalString(input.subjectProviderId);
    const fieldPath = optionalString(input.fieldPath);
    const sourceId = optionalString(input.sourceId);
    if (!evidenceId) throw new Error('[model-gateway/catalog] provider evidenceId is required');
    if (!subjectProviderId) throw new Error('[model-gateway/catalog] subjectProviderId is required');
    if (!fieldPath) throw new Error('[model-gateway/catalog] provider fieldPath is required');
    if (!sourceId) throw new Error('[model-gateway/catalog] provider sourceId is required');
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        evidenceId,
        providerId: normalizeProviderId(input.providerId),
        subjectProviderId: normalizeProviderId(subjectProviderId),
        fieldPath,
        value: sanitizeJsonValue(input.value, sanitizeCatalogString),
        normalizedValue: sanitizeJsonValue(input.normalizedValue ?? input.value, sanitizeCatalogString),
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
 * @param {string} input.subjectProviderId
 * @param {string} [input.displayName]
 * @param {Record<string, unknown>} [input.dataPolicy]
 * @param {Record<string, unknown>} [input.providerMetadata]
 * @param {Record<string, unknown>} [input.provenanceByField]
 * @param {Record<string, unknown>} [input.confidenceByField]
 */
export function createCanonicalProviderProjection(input) {
    const subjectProviderId = optionalString(input.subjectProviderId);
    if (!subjectProviderId) throw new Error('[model-gateway/catalog] projection subjectProviderId is required');
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        providerId: normalizeProviderId(input.providerId),
        subjectProviderId: normalizeProviderId(subjectProviderId),
        displayName: optionalString(input.displayName) ?? subjectProviderId,
        dataPolicy: isRecord(input.dataPolicy) ? sanitizeJsonRecord(input.dataPolicy, sanitizeCatalogString) : {},
        providerMetadata: sanitizeOptionalCatalogRecord(input.providerMetadata),
        provenanceByField: isRecord(input.provenanceByField) ? sanitizeJsonRecord(input.provenanceByField, sanitizeCatalogString) : {},
        confidenceByField: isRecord(input.confidenceByField) ? sanitizeJsonRecord(input.confidenceByField, sanitizeCatalogString) : {},
    };
}

/**
 * @template {Record<string, unknown>} TNormalizedPolicy
 * @template {Record<string, unknown>} TProviderSpecific
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string} [input.routeProfile]
 * @param {string} [input.selectorKind]
 * @param {string} [input.selectorSyntax]
 * @param {string | undefined} [input.sourceId]
 * @param {string | undefined} [input.sourceKind]
 * @param {string | undefined} [input.confidence]
 * @param {TProviderSpecific} [input.providerSpecific]
 * @param {TNormalizedPolicy} input.normalizedPolicy
 */
export function createModelRouteOption(input) {
    const providerModel = optionalString(input.providerModel);
    if (!providerModel) throw new Error('[model-gateway/catalog] route providerModel is required');
    const providerSpecific = sanitizeOptionalCatalogRecord(input.providerSpecific);
    const normalizedPolicy = sanitizeJsonRecord(input.normalizedPolicy, sanitizeCatalogString);
    const selectorKind = optionalString(input.selectorKind) ?? 'exact_model';
    const routeTraits = normalizeModelRoutePolicyTraits({
        selectorKind,
        providerSpecific,
        normalizedPolicy,
    });
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        providerId: normalizeProviderId(input.providerId),
        providerModel,
        routeProfile: optionalString(input.routeProfile),
        selectorKind,
        selectorSyntax: optionalString(input.selectorSyntax) ?? providerModel,
        sourceId: optionalString(input.sourceId),
        sourceKind: optionalString(input.sourceKind) ?? 'unknown',
        confidence: optionalString(input.confidence) ?? MODEL_GATEWAY_CATALOG_CONFIDENCE.UNKNOWN,
        providerSpecific,
        normalizedPolicy: {
            ...normalizedPolicy,
            routeTraits: isRecord(normalizedPolicy['routeTraits']) ? normalizedPolicy['routeTraits'] : routeTraits,
        },
    };
}

/**
 * @template {Record<string, unknown>} TQuota
 * @template {Record<string, unknown>} TRateLimits
 * @template {Record<string, unknown>} TSpendingLimits
 * @template {Record<string, unknown>} TProviderMetadata

 * @param {object} input
 * @param {string} input.providerId
 * @param {string | undefined} [input.accountOverlayId]
 * @param {string | undefined} [input.accountScope]
 * @param {string | undefined} [input.secretRef]
 * @param {string | undefined} [input.organizationIdRef]
 * @param {string | undefined} [input.sourceId]
 * @param {string | undefined} [input.sourceKind]
 * @param {string | undefined} [input.confidence]
 * @param {string[] | undefined} [input.enabledModels]
 * @param {string[] | undefined} [input.blockedModels]
 * @param {string[] | undefined} [input.byokProviderKeys]
 * @param {TQuota} [input.quota]
 * @param {TRateLimits} [input.rateLimits]
 * @param {TSpendingLimits} [input.spendingLimits]
 * @param {Record<string, unknown>} [input.policyHeaders]
 * @param {TProviderMetadata} [input.providerMetadata]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 */
export function createProviderAccountOverlay(input) {
    const providerId = normalizeProviderId(input.providerId);
    const accountScope = optionalString(input.accountScope) ?? 'default';
    const secretRef = optionalString(input.secretRef);
    const sourceId = optionalString(input.sourceId);
    const sourceKind = optionalString(input.sourceKind) ?? 'unknown';
    const safeSourceId = sanitizeCatalogIdentity(sourceId, null);
    const fallbackOverlayId = [providerId, accountScope, secretRef ?? 'no-secret', sourceKind === 'unknown' ? 'account-overlay' : sourceKind].join(':');
    return {
        schemaVersion: MODEL_GATEWAY_CATALOG_SCHEMA_VERSION,
        accountOverlayId: fallbackOverlayId,
        providerId,
        accountScope,
        secretRef,
        organizationIdRef: optionalString(input.organizationIdRef),
        sourceId: safeSourceId,
        sourceKind,
        confidence: optionalString(input.confidence) ?? MODEL_GATEWAY_CATALOG_CONFIDENCE.UNKNOWN,
        enabledModels: stringList(input.enabledModels),
        blockedModels: stringList(input.blockedModels),
        byokProviderKeys: stringList(input.byokProviderKeys),
        quota: sanitizeOptionalCatalogRecord(input.quota),
        rateLimits: sanitizeOptionalCatalogRecord(input.rateLimits),
        spendingLimits: sanitizeOptionalCatalogRecord(input.spendingLimits),
        policyHeaders: isRecord(input.policyHeaders) ? redactSecretRecord(input.policyHeaders) : {},
        providerMetadata: isRecord(input.providerMetadata) ? sanitizeJsonRecord(input.providerMetadata, sanitizeCatalogString) : {},
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
        lifecycle: lifecycleText ?? (isRecord(input.lifecycle) ? sanitizeJsonRecord(input.lifecycle, sanitizeCatalogString) : 'unknown'),
        aliases: Array.isArray(input.aliases)
            ? stringList(input.aliases)
            : isRecord(input.aliases)
              ? sanitizeJsonRecord(input.aliases, sanitizeCatalogString)
              : [],
        family: optionalString(input.family),
        modalities: {
            input: stringList(input.modalities?.input).length > 0 ? stringList(input.modalities?.input) : ['text'],
            output: stringList(input.modalities?.output).length > 0 ? stringList(input.modalities?.output) : ['text'],
        },
        capabilities: isRecord(input.capabilities) ? { ...input.capabilities } : {},
        supportedParameters: stringList(input.supportedParameters),
        unsupportedParameters: stringList(input.unsupportedParameters),
        limits: isRecord(input.limits) ? sanitizeJsonRecord(input.limits, sanitizeCatalogString) : {},
        pricing: isRecord(input.pricing) ? sanitizeJsonRecord(input.pricing, sanitizeCatalogString) : {},
        rateLimits: isRecord(input.rateLimits) ? sanitizeJsonRecord(input.rateLimits, sanitizeCatalogString) : {},
        dataPolicy: isRecord(input.dataPolicy) ? sanitizeJsonRecord(input.dataPolicy, sanitizeCatalogString) : {},
        license: optionalString(input.license),
        providerMetadata: isRecord(input.providerMetadata) ? sanitizeJsonRecord(input.providerMetadata, sanitizeCatalogString) : {},
        openai: isRecord(input.openai) ? sanitizeJsonRecord(input.openai, sanitizeCatalogString) : {},
        provenanceByField: isRecord(input.provenanceByField) ? sanitizeJsonRecord(input.provenanceByField, sanitizeCatalogString) : {},
        confidenceByField: isRecord(input.confidenceByField) ? sanitizeJsonRecord(input.confidenceByField, sanitizeCatalogString) : {},
        routingHints: isRecord(input.routingHints) ? sanitizeJsonRecord(input.routingHints, sanitizeCatalogString) : {},
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
