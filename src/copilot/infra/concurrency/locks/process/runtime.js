// @ts-check
/** Explicit lifecycle owner for the one active process lock configuration. @module copilot/infra/concurrency/locks/process/runtime */

import { activateProcessLockConfig, getActiveProcessLockOwnerSnapshot } from '../process-state/index.js';

/**
 * @param {{
 * processId:string;
 * config:ReturnType<typeof import('./config.js').readProcessLockConfig>;
 * }} options
 */
export function createProcessLockRuntime(options) {
    const processId = String(options?.processId ?? '').trim();
    if (!processId) throw new TypeError('createProcessLockRuntime requires processId.');
    if (!options?.config) throw new TypeError('createProcessLockRuntime requires config.');
    const token = {};
    let state = /** @type {'inactive'|'active'|'disposed'} */ ('inactive');
    /** @type {(() => void) | null} */
    let deactivate = null;

    function activate() {
        if (state === 'disposed') throw new Error(`ProcessLockRuntime(${processId}) is disposed.`);
        if (state === 'active') return snapshot();
        deactivate = activateProcessLockConfig({ token, processId, config: options.config });
        state = 'active';
        return snapshot();
    }

    function snapshot() {
        return Object.freeze({
            processId,
            state,
            config: options.config,
            owner: getActiveProcessLockOwnerSnapshot(),
        });
    }

    function dispose() {
        if (state === 'disposed') return;
        deactivate?.();
        deactivate = null;
        state = 'disposed';
    }

    return Object.freeze({ processId, config: options.config, activate, snapshot, dispose });
}
