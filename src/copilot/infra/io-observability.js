// @ts-check
/**
 * Observabilidade canônica para operações de I/O.
 *
 * Publica eventos via `diagnostics_channel` e registra latência no tool-stats já usado pelo restante de `src/copilot`.
 * O MetricsStore pode consumir o channel sem criar ciclos estáticos `infra -> observability -> config -> tools`.
 *
 * @module copilot/infra/io-observability
 */

import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';
import { logSwallowed } from '../core/error-handlers.js';
import { recordToolCall } from '../observability/tool-stats.js';

const ioOperationChannel = channel('copilot.io.operation');

/**
 * @returns {number}
 */
export function nowIoMs() {
    return performance.now();
}

/**
 * @param {import('../core/io-contracts.js').IoMeta} io
 * @param {{ success: boolean; error?: unknown }} opts
 * @returns {void}
 */
export function publishIoOperation(io, opts) {
    const durationMs = Math.max(0, Math.round(io.durationMs ?? 0));
    const engine = io.engine ?? 'unknown';
    const metricName = `io.${io.operation}.${engine}`;

    try {
        ioOperationChannel.publish({
            ts: Date.now(),
            success: opts.success,
            io,
            ...(opts.error instanceof Error ? { error: { name: opts.error.name, message: opts.error.message } } : {}),
        });
    } catch (error) {
        logSwallowed(error, 'io-observability.diagnostics_channel');
    }

    try {
        recordToolCall(metricName, durationMs, opts.success);
    } catch (error) {
        logSwallowed(error, 'io-observability.metrics');
    }
}
