// @ts-check
/** Canonical coherence commands with an explicit optional runtime bus. @module copilot/infra/filesystem/invalidation/coherence/service */
import { invalidateIoPathPolicyCache } from '#copilot/core';

/** @typedef {ReturnType<typeof import('../bus/index.js').createIoInvalidationBusRuntime>} IoInvalidationBusRuntime */
/** @param {string} filePath @param {{source?:string}} [event] @param {IoInvalidationBusRuntime} [invalidationBus] */
export function invalidateIoCoherencePath(filePath, event = {}, invalidationBus) {
    if (invalidationBus) {
        invalidationBus.publish(filePath, { recursive: false, source: event.source ?? 'io-coherence' });
        return;
    }
    invalidateIoPathPolicyCache(filePath, { recursive: false });
}
/** @param {string} filePath @param {{source?:string}} [event] @param {IoInvalidationBusRuntime} [invalidationBus] */
export function invalidateIoCoherenceSubtree(filePath, event = {}, invalidationBus) {
    if (invalidationBus) {
        invalidationBus.publish(filePath, { recursive: true, source: event.source ?? 'io-coherence' });
        return;
    }
    invalidateIoPathPolicyCache(filePath, { recursive: true });
}
