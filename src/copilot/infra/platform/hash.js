// @ts-check
/**
 * Hashes determinísticos usados por preconditions, índice e evidência de mutação.
 *
 * @module copilot/infra/platform/hash
 */

import { hash as cryptoHash } from 'node:crypto';

/**
 * @param {string | Buffer | Uint8Array} content
 * @returns {string}
 */
export function sha256(content) {
    return cryptoHash('sha256', content, 'hex');
}
