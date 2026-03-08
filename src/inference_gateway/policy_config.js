// @ts-check

import { normalizeInferenceClientTag } from './client_tags.js';

/**
 * @typedef {object} InferencePolicyConfig
 * @property {number} [timeoutMs]
 * @property {number} [maxParallel]
 * @property {string[] | null} [allowedModels]
 * @property {string[] | null} [allowedBackends]
 * @property {number | null} [maxTokens]
 * @property {'degraded_continue' | 'fail_closed' | null} [degradedBehavior]
 */

/**
 * @typedef {object} ResolveInferencePolicyInput
 * @property {unknown} [clientTag]
 * @property {Partial<InferencePolicyConfig> | null} [overrides]
 * @property {Partial<InferencePolicyConfig> | null} [clientPolicy]
 * @property {Partial<InferencePolicyConfig> | null} [profilePolicy]
 * @property {Partial<InferencePolicyConfig> | null} [globalPolicy]
 * @property {Partial<InferencePolicyConfig> | null} [envPolicy]
 * @property {Partial<InferencePolicyConfig> | null} [defaults]
 */

/**
 * @typedef {Required<Pick<InferencePolicyConfig, 'timeoutMs' | 'maxParallel' | 'degradedBehavior'>> & {
 *     maxTokens: number | null;
 *     allowedModels: string[] | null;
 *     allowedBackends: string[] | null;
 * }} EffectiveInferencePolicy
 */

/**
 * @typedef {{
 *     clientTag: import('./client_tags.js').InferenceClientTag;
 *     effective: EffectiveInferencePolicy;
 *     sourcesApplied: string[];
 * }} ResolvedInferencePolicy
 */

/** @param {any} value */
function asPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
}

/** @param {any} value */
function asStringArray(value) {
    if (!Array.isArray(value)) return null;
    const items = value.map((item) => String(item || '').trim()).filter(Boolean);
    return items.length > 0 ? [...new Set(items)] : [];
}

/**
 * @param {any} value
 * @param {number} fallback
 */
function asPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {any} value
 * @param {number | null} [fallback]
 */
function asNonNegativeIntOrNull(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * @param {any} value
 * @param {string} [fallback]
 */
function normalizeDegradedBehavior(value, fallback = 'degraded_continue') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return normalized === 'fail_closed' ? 'fail_closed' : fallback;
}

/**
 * @param {any} target
 * @param {any} layer
 */
function mergeLayer(target, layer) {
    const src = asPlainObject(layer);
    if (!src) return target;

    if ('timeoutMs' in src || 'timeout_ms' in src) {
        target.timeoutMs = asPositiveInt(src.timeoutMs ?? src.timeout_ms, target.timeoutMs);
    }
    if ('maxParallel' in src || 'max_parallel' in src) {
        target.maxParallel = asPositiveInt(src.maxParallel ?? src.max_parallel, target.maxParallel);
    }
    if ('maxTokens' in src || 'max_tokens' in src) {
        target.maxTokens = asNonNegativeIntOrNull(src.maxTokens ?? src.max_tokens, target.maxTokens);
    }
    if ('allowedModels' in src || 'allowed_models' in src) {
        const models = asStringArray(src.allowedModels ?? src.allowed_models);
        if (models !== null) target.allowedModels = models;
    }
    if ('allowedBackends' in src || 'allowed_backends' in src) {
        const backends = asStringArray(src.allowedBackends ?? src.allowed_backends);
        if (backends !== null) target.allowedBackends = backends;
    }
    if ('degradedBehavior' in src || 'degraded_behavior' in src) {
        target.degradedBehavior = normalizeDegradedBehavior(
            src.degradedBehavior ?? src.degraded_behavior,
            target.degradedBehavior,
        );
    }

    return target;
}

/**
 * Resolve política efetiva de inferência por precedência. Ordem (menor -> maior): defaults, env, global, profile,
 * client, overrides.
 *
 * @param {ResolveInferencePolicyInput} input
 * @returns {ResolvedInferencePolicy}
 */
export function resolveInferencePolicy(input = {}) {
    const sourcesApplied = [];
    const base = {
        timeoutMs: 120000,
        maxParallel: 1,
        maxTokens: /** @type {number | null} */ (null),
        allowedModels: /** @type {string[] | null} */ (null),
        allowedBackends: /** @type {string[] | null} */ (null),
        degradedBehavior: /** @type {'degraded_continue' | 'fail_closed'} */ ('degraded_continue'),
    };

    /** @type {[string, unknown][]} */
    const layers = [
        ['defaults', input.defaults],
        ['env', input.envPolicy],
        ['global', input.globalPolicy],
        ['profile', input.profilePolicy],
        ['client', input.clientPolicy],
        ['overrides', input.overrides],
    ];

    for (const [name, layer] of layers) {
        if (asPlainObject(layer)) {
            mergeLayer(base, layer);
            sourcesApplied.push(name);
        }
    }

    return {
        clientTag: normalizeInferenceClientTag(input.clientTag),
        effective: base,
        sourcesApplied,
    };
}

/**
 * @typedef {object} ValidateInferenceRouteEffective
 * @property {string[] | null} allowedModels
 * @property {string[] | null} allowedBackends
 */
/**
 * @typedef {object} ValidateInferenceRouteRequest
 * @property {string | null} [model]
 * @property {string | null} [backend]
 */
/**
 * Valida se uma policy efetiva permite usar backend/model específicos.
 *
 * @param {ValidateInferenceRouteEffective} effective
 * @param {ValidateInferenceRouteRequest} request
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validateInferenceRoute(effective, request) {
    const model = String(request?.model || '').trim();
    const backend = String(request?.backend || '').trim();

    if (effective.allowedBackends && backend && !effective.allowedBackends.includes(backend)) {
        return { ok: false, reason: `backend '${backend}' não permitido` };
    }
    if (effective.allowedModels && model && !effective.allowedModels.includes(model)) {
        return { ok: false, reason: `model '${model}' não permitido` };
    }
    return { ok: true };
}
