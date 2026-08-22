// @ts-check
/** Ripgrep capability acquisition bound to one process-generation subprocess owner. */

import { execSearchFile } from './exec.js';
import { acquireSearchSubprocessProcessLease } from './process/index.js';

/**
 * Acquire one stable capability for the whole search operation. The lease keeps probe and later execution on the same
 * process-generation environment even if ProcessInfra is disposed or replaced while the async operation is in flight.
 */
export function acquireSearchSubprocessCapability() {
    const lease = acquireSearchSubprocessProcessLease();
    return Object.freeze({
        processId: lease.processId,
        environment: lease.environment,
        async isRipgrepAvailable() {
            return lease.resolveRipgrepAvailability(async (environment, timeoutMs) => {
                await execSearchFile('rg', ['--version'], { timeout: timeoutMs, env: environment });
                return true;
            });
        },
    });
}

/** @returns {Promise<boolean>} */
export async function isRipgrepAvailable() {
    return acquireSearchSubprocessCapability().isRipgrepAvailable();
}
