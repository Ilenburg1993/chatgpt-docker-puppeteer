// @ts-check
/** diagnostics_channel publication for IO operations and lifecycle events. */
import { logSwallowed, toError } from '#copilot/core';
import { channel } from 'node:diagnostics_channel';
import { recordIoDurability } from './durability.js';
import { recordIoLatency } from './latency.js';
import { recordIoMutationState } from './mutation-state.js';

const ioOperationChannel = channel('copilot.io.operation');
const lifecycleChannels = {
    budget: channel('copilot.io.budget'),
    cache: channel('copilot.io.cache'),
    index: channel('copilot.io.index'),
    lock: channel('copilot.io.lock'),
    scope: channel('copilot.io.scope'),
    scan: channel('copilot.io.scan'),
};

/** @param {import('#copilot/core/io-contracts').IoMeta} io @param {{ success: boolean; error?: unknown }} opts */
export function publishIoOperation(io, opts) {
    try {
        recordIoLatency(io.operation, io.durationMs);
        recordIoDurability(io);
        recordIoMutationState(io, opts.error);
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
 * @param {boolean} success
 * @param {unknown} [error]
 */
export function publishIoOperationResult(io, success, error) {
    publishIoOperation(io, { success, ...(error !== undefined ? { error } : {}) });
    return io;
}

/**
 * @param {'budget' | 'cache' | 'index' | 'lock' | 'scope' | 'scan'} domain
 * @param {string} phase
 * @param {Record<string, unknown>} payload
 */
export function publishIoLifecycleEvent(domain, phase, payload = {}) {
    try {
        lifecycleChannels[domain].publish({ ts: Date.now(), domain, phase, ...payload });
    } catch (error) {
        logSwallowed(error, `io-observability.lifecycle.${domain}.${phase}`);
    }
}
