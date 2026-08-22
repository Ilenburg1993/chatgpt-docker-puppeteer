// @ts-check
/**
 * Linux PID-only command-line introspection.
 *
 * `/proc` is a process capability, not workspace filesystem authority. Callers provide only a numeric PID and a byte
 * budget; path construction remains private and the reader fails closed on truncation evidence.
 *
 * @module copilot/infra/platform/process/introspection/linux-argv
 */

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export const DEFAULT_LINUX_PROCESS_CMDLINE_MAX_BYTES = 64 * 1024;
export const MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES = 256 * 1024;

/** @param {unknown} value */
function requireProcessId(value) {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
        throw Object.assign(new TypeError('Process PID must be a positive safe integer.'), {
            code: 'ERR_PROCESS_PID_INVALID',
        });
    }
    return Number(value);
}

/** @param {unknown} value */
function normalizeCommandLineBudget(value) {
    const requested = value === undefined ? DEFAULT_LINUX_PROCESS_CMDLINE_MAX_BYTES : Number(value);
    if (!Number.isSafeInteger(requested) || requested <= 0 || requested > MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES) {
        throw Object.assign(
            new RangeError(
                `Process command-line budget must be an integer between 1 and ${MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES}.`,
            ),
            { code: 'ERR_PROCESS_CMDLINE_BUDGET_INVALID' },
        );
    }
    return requested;
}

/**
 * @param {number} pid
 * @param {{maxBytes?:number}} [options]
 * @returns {Promise<Readonly<{pid:number;argv:readonly string[];bytesRead:number;truncated:boolean}>>}
 */
export async function readLinuxProcessArgv(pid, options = {}) {
    const processId = requireProcessId(pid);
    const maxBytes = normalizeCommandLineBudget(options.maxBytes);
    if (process.platform !== 'linux') {
        throw Object.assign(
            new Error(`Linux process command-line introspection is unavailable on ${process.platform}.`),
            {
                code: 'ERR_PROCESS_INTROSPECTION_UNSUPPORTED',
            },
        );
    }

    const handle = await open(`/proc/${processId}/cmdline`, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const bytes = Buffer.allocUnsafe(maxBytes + 1);
        let offset = 0;
        while (offset < bytes.byteLength) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null);
            if (bytesRead === 0) break;
            offset += bytesRead;
        }
        const truncated = offset > maxBytes;
        const content = bytes.subarray(0, Math.min(offset, maxBytes)).toString('utf8');
        const argv = Object.freeze(content.split('\0').filter(Boolean));
        return Object.freeze({ pid: processId, argv, bytesRead: offset, truncated });
    } finally {
        await handle.close();
    }
}
