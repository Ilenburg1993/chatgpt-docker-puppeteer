// @ts-check
/**
 * @module copilot/presentation/runtime-targeting
 * @file Normalização e seleção canônica de `runtimeId` entre HTTP, REPL e façades compartilhadas.
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeRuntimeId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function hasRuntimeId(value) {
    return normalizeRuntimeId(value) !== null;
}

/**
 * @param {...unknown} candidates
 * @returns {string | null}
 */
export function pickRuntimeId(...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeRuntimeId(candidate);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

/**
 * Lê `runtimeId` de payloads usados por handlers compartilhados, incluindo a convenção `{ body: { runtimeId } }`.
 *
 * @param {Record<string, unknown> | null | undefined} params
 * @returns {string | null}
 */
export function readRuntimeIdFromParams(params) {
    if (!params || typeof params !== 'object') return null;
    const body = params['body'];
    return pickRuntimeId(
        params['runtimeId'],
        body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body)['runtimeId'] : null,
    );
}
