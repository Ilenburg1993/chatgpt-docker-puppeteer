// @ts-check
/**
 * Pre-runtime eligibility contracts.
 *
 * Eligibility decisions are derived, account/policy-scoped facts. They decide whether a model route should enter the
 * runtime/probe queue without mutating canonical catalog metadata and without executing inference.
 *
 * @module copilot/model-gateway/eligibility/contracts
 */

import { sanitizeJsonRecord, sanitizeJsonValue } from '../contracts/sanitized-json.js';

export const MODEL_GATEWAY_ELIGIBILITY_SCHEMA_VERSION = 1;

export const MODEL_GATEWAY_ELIGIBILITY_DISPOSITION = Object.freeze({
    ELIGIBLE: 'eligible',
    EXCLUDED: 'excluded',
    UNKNOWN_ALLOWED: 'unknown_policy_allows_probe',
    UNKNOWN_BLOCKED: 'unknown_policy_blocks_probe',
    DEFERRED_MISSING_OVERLAY: 'deferred_missing_overlay',
    DEFERRED_MISSING_SECRET: 'deferred_missing_secret',
});

export const MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS = Object.freeze({
    PROVIDER_NOT_ALLOWED: 'provider_not_allowed',
    PROVIDER_BLOCKED: 'provider_blocked',
    UPSTREAM_PROVIDER_NOT_ALLOWED: 'upstream_provider_not_allowed',
    UPSTREAM_PROVIDER_BLOCKED: 'upstream_provider_blocked',
    ROUTE_LAYER_NOT_ALLOWED: 'route_layer_not_allowed',
    ROUTE_LAYER_BLOCKED: 'route_layer_blocked',
    WIRE_API_NOT_ALLOWED: 'wire_api_not_allowed',
    WIRE_API_BLOCKED: 'wire_api_blocked',
    MODEL_NOT_ALLOWED: 'model_not_allowed',
    MODEL_BLOCKED: 'model_blocked',
    MODEL_DISABLED: 'model_disabled',
    MODEL_RETIRED: 'model_retired',
    MODEL_EXPIRED: 'model_expired',
    SECRET_MISSING: 'secret_missing',
    ACCOUNT_OVERLAY_MISSING: 'account_overlay_missing',
    ACCOUNT_OVERLAY_EXPIRED: 'account_overlay_expired',
    ACCOUNT_ACCESS_UNKNOWN: 'account_access_unknown',
    ACCOUNT_MODEL_BLOCKED: 'account_model_blocked',
    ACCOUNT_MODEL_NOT_VISIBLE: 'account_model_not_visible',
    ACCOUNT_KEY_DISABLED: 'account_key_disabled',
    ACCOUNT_QUOTA_EXHAUSTED: 'account_quota_exhausted',
    ACCOUNT_SPENDING_EXHAUSTED: 'account_spending_exhausted',
    ACCOUNT_RATE_LIMITED: 'account_rate_limited',
    CLOUDFLARE_ACCOUNT_ID_MISSING: 'cloudflare_account_id_missing',
    CLOUDFLARE_GATEWAY_ID_MISSING: 'cloudflare_gateway_id_missing',
    OLLAMA_LOCAL_MODEL_NOT_INSTALLED: 'ollama_local_model_not_installed',
    HEALTH_FATAL: 'health_fatal',
    PRICE_UNKNOWN: 'price_unknown',
    BUDGET_EXCEEDED: 'budget_exceeded',
});

export const MODEL_GATEWAY_ELIGIBILITY_SOFT_REASONS = Object.freeze({
    ACCOUNT_OVERLAY_MISSING: 'account_overlay_missing',
    ACCOUNT_OVERLAY_EXPIRED: 'account_overlay_expired',
    ACCOUNT_VISIBILITY_UNKNOWN: 'account_visibility_unknown',
    PRICE_UNKNOWN: 'price_unknown',
    LOW_CONFIDENCE: 'low_confidence',
    PREVIEW_MODEL: 'preview_model',
    DEPRECATED_MODEL: 'deprecated_model',
    ROUTE_AUTO_SELECTS_UPSTREAM: 'route_auto_selects_upstream',
    CAPABILITY_UNVERIFIED: 'capability_unverified',
    PRICE_ABOVE_PREFERENCE: 'price_above_preference',
});

export const MODEL_GATEWAY_ELIGIBILITY_RUN_STATUS = Object.freeze({
    COMPLETED: 'completed',
    FAILED: 'failed',
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
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
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
 * Eligibility records use a narrower textual redaction policy than catalog audit records, but the structural JSON
 * transformation is identical and therefore shares the same generic sanitizer contract.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeEligibilityString(value) {
    return value.replace(/(bearer|token|secret|api[_-]?key)\s+[\w.:/-]+/giu, '$1 [redacted]');
}

/**
 * @template {Record<string, unknown>} T
 * @param {T | undefined} value
 * @returns {Record<string, unknown> & Partial<import('../contracts/sanitized-json.js').SanitizedRecord<T>>}
 */
function sanitizeOptionalEligibilityRecord(value) {
    return /** @type {Record<string, unknown> & Partial<import('../contracts/sanitized-json.js').SanitizedRecord<T>>} */ (
        isRecord(value) ? sanitizeJsonRecord(value, sanitizeEligibilityString) : {}
    );
}

/**
 * @template {Record<string, unknown>} TPolicyInputs
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string | undefined} [input.routeProfile]
 * @param {string | undefined} [input.selectorKind]
 * @param {string | undefined} [input.selectorSyntax]
 * @param {string | undefined} [input.accountScope]
 * @param {string | undefined} [input.secretRef]
 * @param {string | undefined} [input.policyProfile]
 * @param {string | undefined} [input.taskProfile]
 * @param {boolean} input.include
 * @param {string} [input.disposition]
 * @param {string[]} [input.hardExclusions]
 * @param {string[]} [input.softPenalties]
 * @param {string[]} [input.reasons]
 * @param {string[]} [input.requiredRuntimeProbes]
 * @param {string[]} [input.evidenceRefs]
 * @param {string[]} [input.overlayRefs]
 * @param {string[]} [input.routeOptionRefs]
 * @param {TPolicyInputs} [input.policyInputs]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 */
export function createModelEligibilityDecision(input) {
    const providerId = optionalString(input.providerId);
    const providerModel = optionalString(input.providerModel);
    if (!providerId) throw new Error('[model-gateway/eligibility] providerId is required');
    if (!providerModel) throw new Error('[model-gateway/eligibility] providerModel is required');
    const hardExclusions = stringList(input.hardExclusions);
    const include = Boolean(input.include) && hardExclusions.length === 0;
    return {
        schemaVersion: MODEL_GATEWAY_ELIGIBILITY_SCHEMA_VERSION,
        providerId,
        providerModel,
        routeProfile: optionalString(input.routeProfile),
        selectorKind: optionalString(input.selectorKind) ?? 'exact_model',
        selectorSyntax: optionalString(input.selectorSyntax) ?? providerModel,
        accountScope: optionalString(input.accountScope) ?? 'default',
        secretRef: optionalString(input.secretRef),
        policyProfile: optionalString(input.policyProfile) ?? 'default',
        taskProfile: optionalString(input.taskProfile) ?? 'default',
        include,
        disposition:
            optionalString(input.disposition) ??
            (include ? MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.ELIGIBLE : MODEL_GATEWAY_ELIGIBILITY_DISPOSITION.EXCLUDED),
        hardExclusions,
        softPenalties: stringList(input.softPenalties),
        reasons: stringList(input.reasons),
        requiredRuntimeProbes: stringList(input.requiredRuntimeProbes),
        evidenceRefs: stringList(input.evidenceRefs),
        overlayRefs: stringList(input.overlayRefs),
        routeOptionRefs: stringList(input.routeOptionRefs),
        policyInputs: sanitizeOptionalEligibilityRecord(input.policyInputs),
        observedAt: normalizeIsoDate(input.observedAt) ?? new Date().toISOString(),
        expiresAt: normalizeIsoDate(input.expiresAt),
        redactionStatus: 'sanitized',
    };
}

/**
 * @template {Record<string, unknown>} TPolicyInputs
 * @template TDiff
 * @template TDiffSummary
 * @param {object} input
 * @param {string} input.runId
 * @param {string} [input.status]
 * @param {string | undefined} [input.policyProfile]
 * @param {string | undefined} [input.taskProfile]
 * @param {string | undefined} [input.accountScope]
 * @param {string | number | Date} [input.startedAt]
 * @param {string | number | Date} [input.completedAt]
 * @param {number} [input.modelCount]
 * @param {number} [input.eligibleCount]
 * @param {number} [input.unknownCount]
 * @param {number} [input.excludedCount]
 * @param {string[]} [input.errors]
 * @param {TPolicyInputs} [input.policyInputs]
 * @param {TDiff} [input.diff]
 * @param {TDiffSummary} [input.diffSummary]
 */
export function createModelEligibilityRun(input) {
    const runId = optionalString(input.runId);
    if (!runId) throw new Error('[model-gateway/eligibility] runId is required');
    const startedAt = normalizeIsoDate(input.startedAt) ?? new Date().toISOString();
    const completedAt = normalizeIsoDate(input.completedAt) ?? startedAt;
    return {
        schemaVersion: MODEL_GATEWAY_ELIGIBILITY_SCHEMA_VERSION,
        runId,
        status: optionalString(input.status) ?? MODEL_GATEWAY_ELIGIBILITY_RUN_STATUS.COMPLETED,
        policyProfile: optionalString(input.policyProfile) ?? 'default',
        taskProfile: optionalString(input.taskProfile) ?? 'default',
        accountScope: optionalString(input.accountScope) ?? 'default',
        startedAt,
        completedAt,
        modelCount: nonNegativeInteger(input.modelCount),
        eligibleCount: nonNegativeInteger(input.eligibleCount),
        unknownCount: nonNegativeInteger(input.unknownCount),
        excludedCount: nonNegativeInteger(input.excludedCount),
        errors: stringList(input.errors),
        policyInputs: sanitizeOptionalEligibilityRecord(input.policyInputs),
        diff: sanitizeJsonValue(input.diff ?? null, sanitizeEligibilityString),
        diffSummary: sanitizeJsonValue(input.diffSummary ?? null, sanitizeEligibilityString),
        redactionStatus: 'sanitized',
    };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeInteger(value) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
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
