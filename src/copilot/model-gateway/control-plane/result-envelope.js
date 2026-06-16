// @ts-check
/**
 * Stable, secret-safe result envelope shared by Model Gateway application adapters.
 *
 * @module copilot/model-gateway/control-plane/result-envelope
 */

export const MODEL_GATEWAY_CONTROL_PLANE_RESULT_SCHEMA_VERSION = 'model-gateway.tool-result.v1';

/**
 * @param {object} input
 * @param {string} input.operation
 * @param {unknown} input.data
 * @param {boolean} [input.ok]
 * @param {string} [input.status]
 * @param {boolean} [input.dryRun]
 * @param {string[]} [input.warnings]
 * @param {Array<{ code: string; message: string; retryable: boolean }>} [input.errors]
 * @param {string[]} [input.nextActions]
 * @param {Date | number | string} [input.observedAt]
 * @returns {Record<string, unknown>}
 */
export function createModelGatewayControlPlaneResult(input) {
    const observedAt =
        input.observedAt instanceof Date
            ? input.observedAt.toISOString()
            : typeof input.observedAt === 'number'
              ? new Date(input.observedAt).toISOString()
              : typeof input.observedAt === 'string'
                ? input.observedAt
                : new Date().toISOString();
    return {
        schemaVersion: MODEL_GATEWAY_CONTROL_PLANE_RESULT_SCHEMA_VERSION,
        operation: input.operation,
        ok: input.ok !== false,
        status: input.status ?? (input.ok === false ? 'failed' : 'completed'),
        dryRun: input.dryRun === true,
        data: input.data,
        warnings: [...(input.warnings ?? [])],
        errors: [...(input.errors ?? [])],
        nextActions: [...(input.nextActions ?? [])],
        observedAt,
    };
}
