// @ts-check
/**
 * Emissão opcional de métricas de operação do SDK Wrapper Layer.
 *
 * Este módulo existe para permitir observabilidade em L1 sem criar dependência direta de `sdk/` para `observability/`.
 * O bootstrap de observabilidade injeta um emitter real em runtime; antes disso, o fallback é noop.
 *
 * @module copilot/sdk/telemetry/operation-metrics
 */

import { log } from '../logger.js';

/**
 * @typedef {import('../types.js').SdkOperationMetric} SdkOperationMetric
 *
 * @typedef {import('../types.js').SdkMetricEmitter} SdkMetricEmitter
 */

/** @type {SdkMetricEmitter} */
let _emit = () => {};

/**
 * @param {SdkMetricEmitter | null | undefined} emitter
 */
export function setSdkMetricEmitter(emitter) {
    _emit = typeof emitter === 'function' ? emitter : () => {};
}

/**
 * @param {SdkOperationMetric} metric
 */
export function emitSdkOperationMetric(metric) {
    try {
        _emit(metric);
    } catch (error) {
        log('WARN', `[sdk/telemetry] falha ao emitir métrica SDK: ${/** @type {Error} */ (error).message}`);
    }
}
