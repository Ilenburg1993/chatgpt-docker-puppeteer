// @ts-check
/** diagnostics_channel publication for IO operations and lifecycle events. */
import { logSwallowed, toError } from '#copilot/core';
import { channel } from 'node:diagnostics_channel';

/** @typedef {{ recordOperation(io:import('#copilot/core/io-contracts').IoMeta, opts:{success:boolean;error?:unknown}):void }} IoTelemetryRuntime */

const IO_TELEMETRY_RUNTIME = Symbol('copilot.io.telemetry-runtime');

/**
 * Internal-only carrier used by composed IO facades. The symbol is module-private and never appears on public
 * telemetry surfaces; raw callers cannot forge it without receiving the exact runtime object through composition.
 * @template T
 * @param {T} options
 * @param {IoTelemetryRuntime | undefined} runtime
 * @returns {T}
 */
export function withIoTelemetryRuntimeOption(options, runtime) {
    if (!runtime) return options;
    const base = options && typeof options === 'object' ? options : {};
    return /** @type {T} */ ({ ...base, [IO_TELEMETRY_RUNTIME]: runtime });
}

/** @param {unknown} options @returns {IoTelemetryRuntime | undefined} */
export function getIoTelemetryRuntimeOption(options) {
    if (!options || typeof options !== 'object') return undefined;
    const value = /** @type {Record<PropertyKey, unknown>} */ (options)[IO_TELEMETRY_RUNTIME];
    return value && typeof value === 'object' && 'recordOperation' in value
        ? /** @type {IoTelemetryRuntime} */ (value)
        : undefined;
}
const ioOperationChannel = channel('copilot.io.operation');
const lifecycleChannels = {
    budget: channel('copilot.io.budget'),
    cache: channel('copilot.io.cache'),
    index: channel('copilot.io.index'),
    lock: channel('copilot.io.lock'),
    scope: channel('copilot.io.scope'),
    scan: channel('copilot.io.scan'),
};

/** @param {import('#copilot/core/io-contracts').IoMeta} io @param {{success:boolean;error?:unknown}} opts @param {IoTelemetryRuntime} [telemetryRuntime] */
export function publishIoOperation(io, opts, telemetryRuntime) {
    try {
        telemetryRuntime?.recordOperation(io, opts);
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

/** @param {import('#copilot/core/io-contracts').IoMeta} io @param {boolean} success @param {unknown} [error] @param {IoTelemetryRuntime} [telemetryRuntime] */
export function publishIoOperationResult(io, success, error, telemetryRuntime) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) }, telemetryRuntime);
    return io;
}

/** @param {'budget'|'cache'|'index'|'lock'|'scope'|'scan'} domain @param {string} phase @param {Record<string,unknown>} payload */
export function publishIoLifecycleEvent(domain, phase, payload = {}) {
    try {
        lifecycleChannels[domain].publish({ ts: Date.now(), domain, phase, ...payload });
    } catch (error) {
        logSwallowed(error, `io-observability.lifecycle.${domain}.${phase}`);
    }
}
