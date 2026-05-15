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
import { createHistogram, performance } from 'node:perf_hooks';
import { logSwallowed } from '#copilot/core';

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

/** @type {Map<string, ReturnType<typeof createHistogram>>} */
const _latencyHistograms = new Map();

/**
 * @param {string} operation
 * @returns {ReturnType<typeof createHistogram>}
 */
function getOrCreateHistogram(operation) {
    let histogram = _latencyHistograms.get(operation);
    if (!histogram) {
        histogram = createHistogram();
        _latencyHistograms.set(operation, histogram);
    }
    return histogram;
}

/**
 * @returns {number}
 */
export function nowIoMs() {
    return performance.now();
}

/**
 * @param {import('#copilot/core/io-contracts').IoMeta} io
 * @param {{ success: boolean; error?: unknown }} opts
 * @returns {void}
 */
export function publishIoOperation(io, opts) {
    try {
        recordIoLatency(io.operation, io.durationMs);
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
 * @param {string} operation
 * @param {number | undefined} durationMs
 * @returns {void}
 */
export function recordIoLatency(operation, durationMs) {
    if (!Number.isFinite(durationMs) || Number(durationMs) <= 0) return;
    const ms = Math.max(1, Math.round(Number(durationMs)));
    getOrCreateHistogram(operation).record(ms);
}

/**
 * @returns {Record<string, { mean: number; p50: number; p95: number; p99: number; count: number }>}
 */
export function getIoLatencyStats() {
    /** @type {Record<string, { mean: number; p50: number; p95: number; p99: number; count: number }>} */
    const stats = {};
    for (const [operation, histogram] of _latencyHistograms) {
        stats[operation] = {
            mean: Math.round(histogram.mean),
            p50: histogram.percentile(50),
            p95: histogram.percentile(95),
            p99: histogram.percentile(99),
            count: histogram.count,
        };
    }
    return stats;
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
