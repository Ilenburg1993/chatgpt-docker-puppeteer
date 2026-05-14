// @ts-check
/**
 * Hashes determinísticos usados por preconditions, índice e evidência de mutação.
 *
 * @module copilot/infra/shared/hash
 */

import { createHash } from 'node:crypto';

/**
 * @param {string | Buffer | Uint8Array} content
 * @returns {string}
 */
export function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}
