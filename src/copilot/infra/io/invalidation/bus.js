// @ts-check
/**
 * Bus síncrono e best-effort para invalidações derivadas de mutações de I/O.
 *
 * @module copilot/infra/io/invalidation/bus
 */

import { normalizeIoInvalidationEvent } from './events.js';

/**
 * @typedef {import('./events.js').IoInvalidationEvent} IoInvalidationEvent
 */

/** @type {Array<(filePath: string, event: ReturnType<typeof normalizeIoInvalidationEvent>) => void>} */
const _hooks = [];

/**
 * @param {(filePath: string, event: ReturnType<typeof normalizeIoInvalidationEvent>) => void} hook
 * @returns {() => void}
 */
export function registerIoInvalidationHook(hook) {
    _hooks.push(hook);
    return () => {
        const index = _hooks.indexOf(hook);
        if (index !== -1) _hooks.splice(index, 1);
    };
}

/**
 * @param {string} filePath
 * @param {IoInvalidationEvent} [event]
 */
export function publishIoInvalidation(filePath, event = {}) {
    const normalized = normalizeIoInvalidationEvent(event);
    for (const hook of [..._hooks]) {
        try {
            hook(filePath, normalized);
        } catch {
            /* hooks de invalidação não devem derrubar a mutação canônica */
        }
    }
}
