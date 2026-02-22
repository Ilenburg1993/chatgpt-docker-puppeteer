// @ts-check

import { normalizeInferenceClientTag } from './client_tags.js';

/**
 * @typedef {{
 *   timeoutMs?: number,
 *   maxParallel?: number,
 *   allowedModels?: string[]|null,
 *   allowedBackends?: string[]|null,
 *   maxTokens?: number|null,
 *   degradedBehavior?: 'degraded_continue'|'fail_closed'|null
 * }} InferencePolicyConfig
 */

/**
 * @typedef {{
 *   clientTag?: unknown,
 *   overrides?: Partial<InferencePolicyConfig>|null,
 *   clientPolicy?: Partial<InferencePolicyConfig>|null,
 *   profilePolicy?: Partial<InferencePolicyConfig>|null,
 *   globalPolicy?: Partial<InferencePolicyConfig>|null,
 *   envPolicy?: Partial<InferencePolicyConfig>|null,
 *   defaults?: Partial<InferencePolicyConfig>|null,
 * }} ResolveInferencePolicyInput
 */

function asPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
}

function asStringArray(value) {
    if (!Array.isArray(value)) return null;
    const items = value.map(item => String(item || '').trim()).filter(Boolean);
    return items.length > 0 ? [...new Set(items)] : [];
}

function asPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function asNonNegativeIntOrNull(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function normalizeDegradedBehavior(value, fallback = 'degraded_continue') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'fail_closed' ? 'fail_closed' : fallback;
}

function mergeLayer(target, layer) {
    const src = asPlainObject(layer);
    if (!src) return target;

    if ('timeoutMs' in src || 'timeout_ms' in src) {
        target.timeoutMs = asPositiveInt(/** @type {any} */ (src).timeoutMs ?? /** @type {any} */ (src).timeout_ms, target.timeoutMs);
    }
    if ('maxParallel' in src || 'max_parallel' in src) {
        target.maxParallel = asPositiveInt(
            /** @type {any} */ (src).maxParallel ?? /** @type {any} */ (src).max_parallel,
            target.maxParallel
        );
    }
    if ('maxTokens' in src || 'max_tokens' in src) {
        target.maxTokens = asNonNegativeIntOrNull(
            /** @type {any} */ (src).maxTokens ?? /** @type {any} */ (src).max_tokens,
            target.maxTokens
        );
    }
    if ('allowedModels' in src || 'allowed_models' in src) {
        const models = asStringArray(/** @type {any} */ (src).allowedModels ?? /** @type {any} */ (src).allowed_models);
        if (models !== null) target.allowedModels = models;
    }
    if ('allowedBackends' in src || 'allowed_backends' in src) {
        const backends = asStringArray(
            /** @type {any} */ (src).allowedBackends ?? /** @type {any} */ (src).allowed_backends
        );
        if (backends !== null) target.allowedBackends = backends;
    }
    if ('degradedBehavior' in src || 'degraded_behavior' in src) {
        target.degradedBehavior = normalizeDegradedBehavior(
            /** @type {any} */ (src).degradedBehavior ?? /** @type {any} */ (src).degraded_behavior,
            target.degradedBehavior
        );
    }

    return target;
}

/**
 * Resolve política efetiva de inferência por precedência.
 * Ordem (menor -> maior): defaults, env, global, profile, client, overrides.
 *
 * @param {ResolveInferencePolicyInput} input
 * @returns {{ clientTag: import('./client_tags.js').InferenceClientTag, effective: Required<Pick<InferencePolicyConfig,'timeoutMs'|'maxParallel'|'degradedBehavior'>> & { maxTokens: number|null, allowedModels: string[]|null, allowedBackends: string[]|null }, sourcesApplied: string[] }}
 */
export function resolveInferencePolicy(input = {}) {
    const sourcesApplied = [];
    const base = {
        timeoutMs: 120000,
        maxParallel: 1,
        maxTokens: null,
        allowedModels: null,
        allowedBackends: null,
        degradedBehavior: /** @type {'degraded_continue'|'fail_closed'} */ ('degraded_continue'),
    };

    /** @type {Array<[string, unknown]>} */
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
 * Valida se uma policy efetiva permite usar backend/model específicos.
 *
 * @param {{ allowedModels: string[]|null, allowedBackends: string[]|null }} effective
 * @param {{ model?: string|null, backend?: string|null }} request
 * @returns {{ ok: boolean, reason?: string }}
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
