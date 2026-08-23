// @ts-check
/** Pure process-scoped lock configuration projection. @module copilot/infra/concurrency/locks/process/config */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform/env';
import { readFileResourceLockPolicy } from '../file/index.js';

/**
 * @typedef {Readonly<{
 * file: ReturnType<typeof readFileResourceLockPolicy>;
 * fileConfigurationError: string | null;
 * observability: Readonly<{activeLeaseWarnMs:number}>;
 * }>} ProcessLockConfig
 */

/**
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @param {string} [cwd]
 * @returns {ProcessLockConfig}
 */
export function readProcessLockConfig(env, cwd = process.cwd()) {
    const source = env ?? {};
    let file;
    /** @type {string | null} */
    let fileConfigurationError = null;
    try {
        file = readFileResourceLockPolicy(source, cwd);
    } catch (error) {
        fileConfigurationError = error instanceof Error ? error.message : String(error);
        file = readFileResourceLockPolicy(
            {
                ...source,
                COPILOT_IO_FILE_LOCKS_ENABLED: 'off',
            },
            cwd,
        );
    }
    return Object.freeze({
        file,
        fileConfigurationError,
        observability: Object.freeze({
            activeLeaseWarnMs: readEnvPositiveInt('IO_LOCK_ACTIVE_LEASE_WARN_MS', 60_000, source),
        }),
    });
}
