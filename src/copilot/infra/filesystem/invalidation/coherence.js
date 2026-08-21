// @ts-check
/**
 * Canonical coherence commands for workspace I/O.
 *
 * This module is intentionally tiny: the invalidation bus is the single owner of local cache/policy invalidation,
 * derived-state notification and cross-process replication. Callers publish semantic change events here instead of
 * reaching into individual cache tiers.
 *
 * @module copilot/infra/filesystem/invalidation/coherence
 */

import { publishIoInvalidation } from './bus/index.js';

/**
 * @param {string} filePath
 * @param {{ source?: string }} [event]
 */
export function invalidateIoCoherencePath(filePath, event = {}) {
    publishIoInvalidation(filePath, {
        recursive: false,
        source: event.source ?? 'io-coherence',
    });
}

/**
 * @param {string} filePath
 * @param {{ source?: string }} [event]
 */
export function invalidateIoCoherenceSubtree(filePath, event = {}) {
    publishIoInvalidation(filePath, {
        recursive: true,
        source: event.source ?? 'io-coherence',
    });
}
