// @ts-check
/**
 * Invalidação coordenada de tiers de cache de I/O.
 *
 * @module copilot/infra/io/invalidation/cache-tiers
 */

import { getIoL2Cache } from '../../io-cache-l2-registry.js';
import { invalidateIoCachePath, invalidateIoCacheSubtree } from '../../io-cache.js';
import { flushIoInvalidationQueue } from './bus.js';

/**
 * @param {string} filePath
 */
export function invalidateIoCacheTiers(filePath) {
    try {
        invalidateIoCachePath(filePath);
    } catch {
        // best-effort: falha em cache não pode interromper mutação canônica
    }
    const l2 = getIoL2Cache();
    if (l2) {
        try {
            l2.invalidatePath(filePath);
        } catch {
            // best-effort: falha em L2 não pode interromper mutação canônica
        }
    }
    flushIoInvalidationQueue();
}

/**
 * @param {string} filePath
 */
export function invalidateIoCacheTierSubtrees(filePath) {
    try {
        invalidateIoCacheSubtree(filePath);
    } catch {
        // best-effort: falha em cache não pode interromper mutação canônica
    }
    const l2 = getIoL2Cache();
    if (l2) {
        try {
            l2.invalidatePath(filePath);
        } catch {
            // best-effort: falha em L2 não pode interromper mutação canônica
        }
    }
    flushIoInvalidationQueue();
}
