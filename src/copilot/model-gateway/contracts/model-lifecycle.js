// @ts-check
/**
 * Canonical lifecycle semantics for model records.
 *
 * @module copilot/model-gateway/contracts/model-lifecycle
 */

export const MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS = Object.freeze({
    ACTIVE: 'active',
    DEPRECATED: 'deprecated',
    RETIRED: 'retired',
    EXPIRED: 'expired',
});

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function timestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {Record<string, any>} model
 * @param {{ now?: number }} [options]
 */
export function evaluateModelGatewayModelLifecycle(model, options = {}) {
    const now = options.now ?? Date.now();
    const lifecycle = model['lifecycle'] && typeof model['lifecycle'] === 'object'
        ? /** @type {Record<string, any>} */ (model['lifecycle'])
        : model;
    const deprecatedAtMs = timestamp(lifecycle['deprecatedAt']);
    const retiredAtMs = timestamp(lifecycle['retiredAt']);
    const expiresAtMs = timestamp(lifecycle['expiresAt']);
    const explicitStatus = typeof lifecycle['status'] === 'string' ? lifecycle['status'] : null;
    const retired = explicitStatus === 'retired' || (retiredAtMs !== null && retiredAtMs <= now);
    const expired = expiresAtMs !== null && expiresAtMs <= now;
    const deprecated =
        explicitStatus === 'deprecated' || (deprecatedAtMs !== null && deprecatedAtMs <= now);
    const status = retired
        ? MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.RETIRED
        : expired
          ? MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.EXPIRED
          : deprecated
            ? MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.DEPRECATED
            : MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.ACTIVE;
    return {
        schemaVersion: 1,
        status,
        routable: status === MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.ACTIVE,
        requiresExplicitOptIn: status === MODEL_GATEWAY_MODEL_LIFECYCLE_STATUS.DEPRECATED,
        deprecatedAt: deprecatedAtMs === null ? null : new Date(deprecatedAtMs).toISOString(),
        retiredAt: retiredAtMs === null ? null : new Date(retiredAtMs).toISOString(),
        expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
        reasons: [
            ...(retired ? ['model_retired'] : []),
            ...(expired ? ['model_expired'] : []),
            ...(deprecated && !retired && !expired ? ['model_deprecated'] : []),
        ],
    };
}
