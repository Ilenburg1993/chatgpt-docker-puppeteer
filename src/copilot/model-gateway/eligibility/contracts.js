// @ts-check
/**
 * Pre-runtime eligibility contracts.
 *
 * Eligibility decisions are derived, account/policy-scoped facts. They decide whether a model route should enter the
 * runtime/probe queue without mutating canonical catalog metadata and without executing inference.
 *
 * @module copilot/model-gateway/eligibility/contracts
 */

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
    MODEL_NOT_ALLOWED: 'model_not_allowed',
    MODEL_BLOCKED: 'model_blocked',
    MODEL_DISABLED: 'model_disabled',
    MODEL_RETIRED: 'model_retired',
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
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeJsonValue(value) {
    if (typeof value === 'string') return value.replace(/(bearer|token|secret|api[_-]?key)\s+[\w.:/-]+/giu, '$1 [redacted]');
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
 * @param {object} input
 * @param {string} input.providerId
 * @param {string} input.providerModel
 * @param {string} [input.routeProfile]
 * @param {string} [input.selectorKind]
 * @param {string} [input.selectorSyntax]
 * @param {string} [input.accountScope]
 * @param {string} [input.secretRef]
 * @param {string} [input.policyProfile]
 * @param {string} [input.taskProfile]
 * @param {boolean} input.include
 * @param {string} [input.disposition]
 * @param {string[]} [input.hardExclusions]
 * @param {string[]} [input.softPenalties]
 * @param {string[]} [input.reasons]
 * @param {string[]} [input.requiredRuntimeProbes]
 * @param {string[]} [input.evidenceRefs]
 * @param {string[]} [input.overlayRefs]
 * @param {string[]} [input.routeOptionRefs]
 * @param {Record<string, unknown>} [input.policyInputs]
 * @param {string | number | Date} [input.observedAt]
 * @param {string | number | Date | null} [input.expiresAt]
 * @returns {object}
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
        policyInputs: isRecord(input.policyInputs) ? sanitizeJsonValue(input.policyInputs) : {},
        observedAt: normalizeIsoDate(input.observedAt) ?? new Date().toISOString(),
        expiresAt: normalizeIsoDate(input.expiresAt),
        redactionStatus: 'sanitized',
    };
}

/**
 * @param {object} input
 * @param {string} input.runId
 * @param {string} [input.status]
 * @param {string} [input.policyProfile]
 * @param {string} [input.taskProfile]
 * @param {string} [input.accountScope]
 * @param {string | number | Date} [input.startedAt]
 * @param {string | number | Date} [input.completedAt]
 * @param {number} [input.modelCount]
 * @param {number} [input.eligibleCount]
 * @param {number} [input.unknownCount]
 * @param {number} [input.excludedCount]
 * @param {string[]} [input.errors]
 * @param {Record<string, unknown>} [input.policyInputs]
 * @returns {object}
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
        policyInputs: isRecord(input.policyInputs) ? sanitizeJsonValue(input.policyInputs) : {},
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
