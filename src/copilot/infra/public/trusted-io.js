// @ts-check
import path from 'node:path';
/**
 * Explicitly trusted IO for configured runtime paths that may live outside the workspace.
 *
 * Consumers must identify themselves on every call. This facade deliberately does not apply workspace containment;
 * callers are responsible for obtaining the path from a trusted configuration source.
 *
 * @module copilot/infra/public/trusted-io
 */

import { removePathLocked } from '../io/fs/locked-mutations.js';
import { chmodFileLocked, mkdirPathLocked, openDetachedAppendSinkLocked } from '../io/fs/locked-writes.js';
import { writeFileAtomicPortable } from '../io/fs/portable-atomic.js';
import { watchPath } from '../io/fs/watch.js';
import { readJsonlTail } from '../io/jsonl-reader.js';
import {
    listDirectoryNamesFresh,
    lstatPath,
    readBytesFresh,
    readBytesRangeFresh,
    readTextFresh,
    statPath,
} from '../io/fs/read-services.js';

/**
 * @typedef {object} TrustedAtomicWriteOptions
 * @property {string} caller Stable owner identifier used by architecture governance and diagnostics.
 * @property {number} [mode]
 * @property {import('../io/fs/durability.js').IoDurabilityMode} [durability]
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
 * Create a configured/trusted directory through canonical lock + namespace durability without applying workspace
 * containment. This is intended for runtime paths obtained from trusted configuration only.
 *
 * @param {string} dirPath
 * @param {{ caller: string; recursive?: boolean; mode?: number; durability?: import('../io/fs/durability.js').IoDurabilityMode }} options
 */
export async function mkdirPathTrusted(dirPath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('mkdirPathTrusted requires a non-empty caller');
    const { caller: _caller, ...mkdirOptions } = options;
    return mkdirPathLocked(dirPath, {
        ...mkdirOptions,
        advisoryLimits: { caller },
    });
}

/**
 * Watch one configured/trusted path through the canonical low-level watch primitive.
 *
 * @param {string} targetPath
 * @param {{ caller: string; persistent?: boolean; recursive?: boolean }} options
 * @param {import('node:fs').WatchListener<string>} listener
 */
export function watchPathTrusted(targetPath, options, listener) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('watchPathTrusted requires a non-empty caller');
    const { caller: _caller, ...watchOptions } = options;
    return watchPath(targetPath, { encoding: 'utf8', ...watchOptions }, listener);
}

/**
 * Open an append sink whose descriptor will be inherited by a detached child process. Parent creation and pathname
 * publication use canonical IO; subsequent writes are explicitly owned by the child holding the inherited descriptor.
 *
 * @param {string} filePath
 * @param {{ caller: string; mode?: number; durability?: import('../io/fs/durability.js').IoDurabilityMode }} options
 */
export async function openDetachedAppendSinkTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('openDetachedAppendSinkTrusted requires a non-empty caller');
    await mkdirPathLocked(path.dirname(filePath), {
        recursive: true,
        ...(options.durability === undefined ? {} : { durability: options.durability }),
        advisoryLimits: { caller, purpose: 'detached-append-sink-parent' },
    });
    return openDetachedAppendSinkLocked(filePath, {
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.durability === undefined ? {} : { durability: options.durability }),
        advisoryLimits: { caller, purpose: 'detached-append-sink' },
    });
}

/**
 * Change mode for one configured/trusted regular file through the canonical metadata mutation boundary.
 *
 * @param {string} filePath
 * @param {number} mode
 * @param {{ caller: string; durability?: import('../io/fs/durability.js').IoDurabilityMode }} options
 */
export async function chmodFileTrusted(filePath, mode, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('chmodFileTrusted requires a non-empty caller');
    return chmodFileLocked(filePath, mode, {
        ...(options.durability === undefined ? {} : { durability: options.durability }),
        advisoryLimits: { caller },
    });
}

/**
 * Delete one configured/trusted path non-recursively through canonical lock + namespace durability without reading/hash-ing
 * its contents. `ignoreMissing=true` preserves cleanup semantics while ENOENT remains distinguishable internally.
 *
 * @param {string} filePath
 * @param {{ caller: string; ignoreMissing?: boolean; durability?: import('../io/fs/durability.js').IoDurabilityMode }} options
 */
export async function deleteFileTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('deleteFileTrusted requires a non-empty caller');
    try {
        return await removePathLocked(filePath, {
            recursive: false,
            force: false,
            ...(options.durability === undefined ? {} : { durability: options.durability }),
        });
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (options.ignoreMissing === true && (code === 'ENOENT' || code === 'ENOTDIR')) return null;
        throw error;
    }
}

/**
 * Fresh, cache-bypassing text read for configured runtime paths. The caller identity is attached to IO observability.
 *
 * @param {string} filePath
 * @param {{ caller: string; traceId?: string; signal?: AbortSignal; includeHash?: boolean; advisoryLimits?: Record<string, unknown> }} options
 */
export async function readTextFreshTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('readTextFreshTrusted requires a non-empty caller');
    const { caller: _caller, advisoryLimits, ...readOptions } = options;
    return readTextFresh(filePath, {
        ...readOptions,
        advisoryLimits: { ...(advisoryLimits ?? {}), caller },
    });
}

/**
 * Fresh, cache-bypassing binary read for configured runtime paths.
 *
 * @param {string} filePath
 * @param {{ caller: string; traceId?: string; signal?: AbortSignal; includeHash?: boolean; advisoryLimits?: Record<string, unknown> }} options
 */
export async function readBytesFreshTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('readBytesFreshTrusted requires a non-empty caller');
    const { caller: _caller, advisoryLimits, ...readOptions } = options;
    return readBytesFresh(filePath, {
        ...readOptions,
        advisoryLimits: { ...(advisoryLimits ?? {}), caller },
    });
}

/**
 * Bounded physical byte range/tail read for configured runtime paths.
 *
 * @param {string} filePath
 * @param {{
 *     caller: string;
 *     start?: number;
 *     maxBytes: number;
 *     fromEnd?: boolean;
 *     rejectSymlink?: boolean;
 *     traceId?: string;
 *     advisoryLimits?: Record<string, unknown>;
 *     signal?: AbortSignal;
 * }} options
 */
export async function readBytesRangeFreshTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('readBytesRangeFreshTrusted requires a non-empty caller');
    const { caller: _caller, advisoryLimits, ...readOptions } = options;
    return readBytesRangeFresh(filePath, {
        ...readOptions,
        advisoryLimits: { ...(advisoryLimits ?? {}), caller },
    });
}

/**
 * Bounded JSONL tail read for configured runtime paths. Parsing, UTF-8 validation, partial-line handling and byte
 * budgets remain centralized in the canonical JSONL reader; caller identity stays explicit at the trusted boundary.
 *
 * @param {string} filePath
 * @param {{
 *     caller: string;
 *     maxLines?: number;
 *     blockSize?: number;
 *     maxBytes?: number;
 *     repairTrailingPartial?: boolean;
 *     maxTrailingRecordBytes?: number;
 *     flushRepairToDisk?: boolean;
 * }} options
 */
export async function readJsonlTailTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('readJsonlTailTrusted requires a non-empty caller');
    const { caller: _caller, ...readOptions } = options;
    return readJsonlTail(filePath, readOptions);
}

/**
 * Fresh directory names for configured runtime paths, without materializing the directory when it is absent.
 *
 * @param {string} dirPath
 * @param {{ caller: string; traceId?: string; advisoryLimits?: Record<string, unknown> }} options
 */
export async function listDirectoryNamesFreshTrusted(dirPath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('listDirectoryNamesFreshTrusted requires a non-empty caller');
    const { caller: _caller, advisoryLimits, ...readOptions } = options;
    return listDirectoryNamesFresh(dirPath, {
        ...readOptions,
        advisoryLimits: { ...(advisoryLimits ?? {}), caller },
    });
}

/**
 * Fresh lstat for configured runtime paths. Unlike statPathTrusted, this deliberately does not follow symlinks.
 *
 * @param {string} filePath
 * @param {{ caller: string; traceId?: string; advisoryLimits?: Record<string, unknown> }} options
 */
export async function lstatPathTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('lstatPathTrusted requires a non-empty caller');
    const { caller: _caller, advisoryLimits, ...statOptions } = options;
    return lstatPath(filePath, {
        ...statOptions,
        advisoryLimits: { ...(advisoryLimits ?? {}), caller },
    });
}

/**
 * @param {string} filePath
 * @param {{ caller: string; traceId?: string; advisoryLimits?: Record<string, unknown> }} options
 */
export async function statPathTrusted(filePath, options) {
    const caller = options?.caller?.trim();
    if (!caller) throw new TypeError('statPathTrusted requires a non-empty caller');
    const { caller: _caller, advisoryLimits, ...statOptions } = options;
    return statPath(filePath, {
        ...statOptions,
        advisoryLimits: { ...(advisoryLimits ?? {}), caller },
    });
}
