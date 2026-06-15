// @ts-check
/**
 * Observabilidade canônica para operações de I/O.
 *
 * Publica eventos via `diagnostics_channel`; a telemetria agregada é consumida centralmente pelo bootstrap de
 * observabilidade, mantendo uma única autoridade de contagem e evitando dupla escrituração.
 *
 * @module copilot/infra/io-observability
 */

import { logSwallowed, toError } from '#copilot/core';
import { channel } from 'node:diagnostics_channel';
import { createHistogram, performance } from 'node:perf_hooks';

const ioOperationChannel = channel('copilot.io.operation');
const ioCacheChannel = channel('copilot.io.cache');
const ioIndexChannel = channel('copilot.io.index');
const ioLockChannel = channel('copilot.io.lock');
const ioScopeChannel = channel('copilot.io.scope');
const ioScanChannel = channel('copilot.io.scan');
const ioBudgetChannel = channel('copilot.io.budget');

const lifecycleChannels = {
    budget: ioBudgetChannel,
    cache: ioCacheChannel,
    index: ioIndexChannel,
    lock: ioLockChannel,
    scope: ioScopeChannel,
    scan: ioScanChannel,
};

const MAX_IO_LATENCY_HISTOGRAMS = 64;

/** @type {Map<string, ReturnType<typeof createHistogram>>} */
const _latencyHistograms = new Map();
const _durabilityStats = {
    operationsObserved: 0,
    operationsWithMetadata: 0,
    fileFlushRequested: 0,
    modes: { none: 0, file: 0, 'file-and-directory': 0 },
    fileSync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0 },
    directorySync: { attempted: 0, confirmed: 0, skipped: 0, failed: 0 },
    /** @type {{ kind: 'file' | 'directory'; operation: string; errorCode: string | null; at: number } | null} */
    lastFailure: null,
};

/**
 * @param {string} operation
 * @returns {ReturnType<typeof createHistogram>}
 */
function getOrCreateHistogram(operation) {
    let histogram = _latencyHistograms.get(operation);
    if (!histogram) {
        if (_latencyHistograms.size >= MAX_IO_LATENCY_HISTOGRAMS) {
            const oldest = _latencyHistograms.keys().next().value;
            if (typeof oldest === 'string') _latencyHistograms.delete(oldest);
        }
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
        recordIoDurability(io);
        ioOperationChannel.publish({
            ts: Date.now(),
            success: opts.success,
            io,
            ...(opts.error != null
                ? (() => {
                      const normalized = toError(opts.error);
                      return { error: { name: normalized.name, message: normalized.message } };
                  })()
                : {}),
        });
    } catch (error) {
        logSwallowed(error, 'io-observability.diagnostics_channel');
    }
}

/**
 * @param {import('#copilot/core/io-contracts').IoMeta} io
 */
function recordIoDurability(io) {
    _durabilityStats.operationsObserved += 1;
    const advisory = io.advisoryLimits;
    if (!advisory || typeof advisory !== 'object') return;
    let found = false;
    const durability = asRecord(advisory['durability']);
    if (durability) {
        found = true;
        const mode = durability['durability'];
        if (mode === 'none' || mode === 'file' || mode === 'file-and-directory') _durabilityStats.modes[mode] += 1;
        if (durability['fileFlushRequested'] === true) _durabilityStats.fileFlushRequested += 1;
        recordSyncResult('directory', durability['directorySync'], io.operation);
    }
    const syncFields = /** @type {const} */ ([
        ['file', 'fileSync'],
        ['directory', 'destinationDirectorySync'],
        ['directory', 'sourceDirectorySync'],
    ]);
    for (const [kind, key] of syncFields) {
        if (!(key in advisory)) continue;
        found = true;
        recordSyncResult(kind, advisory[key], io.operation);
    }
    if (found) _durabilityStats.operationsWithMetadata += 1;
}

/**
 * @param {'file' | 'directory'} kind
 * @param {unknown} value
 * @param {string} operation
 */
function recordSyncResult(kind, value, operation) {
    const result = asRecord(value);
    if (!result || result['attempted'] !== true) return;
    const counters = kind === 'file' ? _durabilityStats.fileSync : _durabilityStats.directorySync;
    counters.attempted += 1;
    if (result['ok'] === true) {
        counters.confirmed += 1;
        return;
    }
    if (typeof result['skippedReason'] === 'string' && result['skippedReason']) {
        counters.skipped += 1;
        return;
    }
    counters.failed += 1;
    _durabilityStats.lastFailure = {
        kind,
        operation,
        errorCode: typeof result['errorCode'] === 'string' ? result['errorCode'] : null,
        at: Date.now(),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
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
 * @returns {typeof _durabilityStats}
 */
export function getIoDurabilityStats() {
    return {
        ..._durabilityStats,
        modes: { ..._durabilityStats.modes },
        fileSync: { ..._durabilityStats.fileSync },
        directorySync: { ..._durabilityStats.directorySync },
        lastFailure: _durabilityStats.lastFailure ? { ..._durabilityStats.lastFailure } : null,
    };
}

/**
 * Publica eventos de lifecycle mais granulares sem acoplar `infra/` a collectors específicos.
 *
 * @param {'budget' | 'cache' | 'index' | 'lock' | 'scope' | 'scan'} domain
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
