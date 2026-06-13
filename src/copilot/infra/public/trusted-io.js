// @ts-check
/**
 * Explicitly trusted IO for configured runtime paths that may live outside the workspace.
 *
 * Consumers must identify themselves on every call. This facade deliberately does not apply workspace containment;
 * callers are responsible for obtaining the path from a trusted configuration source.
 *
 * @module copilot/infra/public/trusted-io
 */

import { writeFileAtomicPortable } from '../io/fs/portable-atomic.js';
import { statPath } from '../io/fs/read-services.js';

/**
 * @typedef {object} TrustedAtomicWriteOptions
 * @property {string} caller Stable owner identifier used by architecture governance and diagnostics.
 * @property {number} [mode]
 */

/**
 * @param {string} filePath
 * @param {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} content
 * @param {TrustedAtomicWriteOptions} options
 * @returns {Promise<void>}
 */
export async function writeFileAtomicTrusted(filePath, content, options) {
    const caller = options?.caller?.trim();
    if (!caller) {
        throw new TypeError('writeFileAtomicTrusted requires a non-empty caller');
    }

    const { caller: _caller, ...writeOptions } = options;
    await writeFileAtomicPortable(filePath, content, writeOptions);
}

/**
 * @param {string} filePath
 * @param {{ caller: string; traceId?: string; advisoryLimits?: Record<string, unknown> }} options
 */
export async function statPathTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) {
        throw new TypeError('statPathTrusted requires a non-empty caller');
    }

    const { caller: _caller, ...statOptions } = options;
    return statPath(filePath, statOptions);
}
