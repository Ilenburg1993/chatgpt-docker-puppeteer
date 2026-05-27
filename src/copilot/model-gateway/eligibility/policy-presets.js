// @ts-check
/**
 * Formal pre-runtime eligibility policy presets.
 *
 * Presets are only defaults. Callers may override any field, but every high-level selector/runtime path should start
 * from a named preset instead of hand-building unrelated combinations of account, pricing and health rules.
 *
 * @module copilot/model-gateway/eligibility/policy-presets
 */

export const MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET = Object.freeze({
    DEFAULT: 'default',
    PERMISSIVE_PROBE: 'permissive_probe',
    STRICT_ACCOUNT: 'strict_account',
    FRESH_ACCOUNT: 'fresh_account',
    METADATA_ONLY: 'metadata_only',
    FREE_OR_KNOWN_COST: 'free_or_known_cost',
});

const DEFAULT_ELIGIBILITY_POLICY = Object.freeze({
    unknownAccessPolicy: 'allow_probe',
    treatEnabledModelsAsClosed: true,
    allowRetired: false,
    excludeFailedHealth: true,
    requireKnownPricing: false,
    defaultRuntimeProbes: Object.freeze(['chat']),
});

/** @type {Readonly<Record<string, Record<string, unknown>>>} */
const POLICY_PRESETS = Object.freeze({
    [MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.DEFAULT]: DEFAULT_ELIGIBILITY_POLICY,
    [MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.PERMISSIVE_PROBE]: Object.freeze({
        ...DEFAULT_ELIGIBILITY_POLICY,
        unknownAccessPolicy: 'allow_probe',
        treatEnabledModelsAsClosed: false,
        requireAccountOverlay: false,
        requireFreshAccountOverlay: false,
    }),
    [MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.STRICT_ACCOUNT]: Object.freeze({
        ...DEFAULT_ELIGIBILITY_POLICY,
        unknownAccessPolicy: 'block',
        requireAccountOverlay: true,
        treatEnabledModelsAsClosed: true,
    }),
    [MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.FRESH_ACCOUNT]: Object.freeze({
        ...DEFAULT_ELIGIBILITY_POLICY,
        unknownAccessPolicy: 'block',
        requireAccountOverlay: true,
        requireFreshAccountOverlay: true,
        treatEnabledModelsAsClosed: true,
    }),
    [MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.METADATA_ONLY]: Object.freeze({
        ...DEFAULT_ELIGIBILITY_POLICY,
        unknownAccessPolicy: 'allow_probe',
        excludeFailedHealth: false,
        requireAccountOverlay: false,
    }),
    [MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.FREE_OR_KNOWN_COST]: Object.freeze({
        ...DEFAULT_ELIGIBILITY_POLICY,
        requireKnownPricing: true,
        maxInputUsdPerMillion: 0,
        maxOutputUsdPerMillion: 0,
        maxRequestUsd: 0,
    }),
});

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePresetId(value) {
    const raw = optionalString(value)?.toLowerCase().replaceAll('-', '_') ?? MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.DEFAULT;
    return POLICY_PRESETS[raw] ? raw : MODEL_GATEWAY_ELIGIBILITY_POLICY_PRESET.DEFAULT;
}

/**
 * @param {unknown} preset
 * @returns {Record<string, unknown>}
 */
export function getModelGatewayEligibilityPolicyPreset(preset) {
    return { ...(POLICY_PRESETS[normalizePresetId(preset)] ?? DEFAULT_ELIGIBILITY_POLICY) };
}

/**
 * @param {Record<string, unknown>} [policy]
 * @returns {Record<string, unknown> & { policyPreset: string }}
 */
export function resolveModelGatewayEligibilityPolicy(policy = {}) {
    const input = isRecord(policy) ? policy : {};
    const policyPreset = normalizePresetId(input['policyPreset'] ?? input['preset']);
    return {
        ...getModelGatewayEligibilityPolicyPreset(policyPreset),
        ...input,
        policyPreset,
    };
}

/**
 * @returns {Array<{ id: string; policy: Record<string, unknown> }>}
 */
export function listModelGatewayEligibilityPolicyPresets() {
    return Object.keys(POLICY_PRESETS).sort().map((id) => ({
        id,
        policy: getModelGatewayEligibilityPolicyPreset(id),
    }));
}
