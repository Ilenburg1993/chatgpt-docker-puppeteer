// @ts-check
/** Pure rollback configuration projection. No operational function in this module reads process.env. */

import { booleanValueOr, positiveIntegerOr } from '#copilot/infra/internal/platform/config-values';
import path from 'node:path';

export const DEFAULT_ROLLBACK_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ROLLBACK_MAX_ENTRIES = 32;
export const DEFAULT_ROLLBACK_MAX_BYTES = 32 * 1024 * 1024;

/**
 * @typedef {Readonly<{
 *   enabled:boolean;
 *   directory:string;
 *   ttlMs:number;
 *   maxEntries:number;
 *   maxBytes:number;
 * }>} IoRollbackPolicy
 */

/** @param {string} cwd */
function defaultRollbackDirectory(cwd) {
    return path.join(path.resolve(cwd), 'src', 'copilot', '.ai', 'rollback');
}

/**
 * Environment-independent default used by raw primitives when no composition policy was supplied.
 * Raw operations never enable rollback implicitly.
 * @param {string} [cwd]
 * @returns {IoRollbackPolicy}
 */
export function createDefaultIoRollbackPolicy(cwd = process.cwd()) {
    return Object.freeze({
        enabled: false,
        directory: defaultRollbackDirectory(cwd),
        ttlMs: DEFAULT_ROLLBACK_TTL_MS,
        maxEntries: DEFAULT_ROLLBACK_MAX_ENTRIES,
        maxBytes: DEFAULT_ROLLBACK_MAX_BYTES,
    });
}

/**
 * Project an explicit environment snapshot into one immutable runtime rollback policy.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @param {string} [cwd]
 * @returns {IoRollbackPolicy}
 */
export function readIoRollbackPolicy(env, cwd = process.cwd()) {
    const source = env ?? {};
    const configuredDirectory = String(source['COPILOT_IO_ROLLBACK_DIR'] ?? '').trim();
    return Object.freeze({
        enabled: booleanValueOr(source['COPILOT_IO_ROLLBACK_ENABLED'], false),
        directory: configuredDirectory ? path.resolve(configuredDirectory) : defaultRollbackDirectory(cwd),
        ttlMs: positiveIntegerOr(source['COPILOT_IO_ROLLBACK_TTL_MS'], DEFAULT_ROLLBACK_TTL_MS),
        maxEntries: positiveIntegerOr(source['COPILOT_IO_ROLLBACK_MAX_ENTRIES'], DEFAULT_ROLLBACK_MAX_ENTRIES),
        maxBytes: positiveIntegerOr(source['COPILOT_IO_ROLLBACK_MAX_BYTES'], DEFAULT_ROLLBACK_MAX_BYTES),
    });
}
