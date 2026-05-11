// @ts-check
/**
 * Observabilidade canônica para operações de I/O.
 *
 * Publica eventos via `diagnostics_channel`; a telemetria agregada é consumida centralmente pelo bootstrap de
 * observabilidade, mantendo uma única autoridade de contagem e evitando dupla escrituração.
 *
 * @module copilot/infra/io-observability
 */

import { channel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';
import { logSwallowed } from '../core/error-handlers.js';

const ioOperationChannel = channel('copilot.io.operation');
const ioCacheChannel = channel('copilot.io.cache');
const ioIndexChannel = channel('copilot.io.index');
const ioScopeChannel = channel('copilot.io.scope');
const ioScanChannel = channel('copilot.io.scan');

const lifecycleChannels = {
    cache: ioCacheChannel,
    index: ioIndexChannel,
    scope: ioScopeChannel,
    scan: ioScanChannel,
};

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
}

/**
 * Publica eventos de lifecycle mais granulares sem acoplar `infra/` a collectors específicos.
 *
 * @param {'cache' | 'index' | 'scope' | 'scan'} domain
 * @param {string} phase
 * @param {Record<string, unknown>} payload
 * @returns {void}
 */
export function publishIoLifecycleEvent(domain, phase, payload = {}) {
    try {
        lifecycleChannels[domain].publish({
            ts: Date.now(),
            domain,
            phase,
            ...payload,
        });
    } catch (error) {
        logSwallowed(error, `io-observability.lifecycle.${domain}.${phase}`);
    }
}
