// @ts-check
/**
 * Preconditions reutilizáveis para mutações de I/O.
 *
 * @module copilot/infra/policy/preconditions
 */

import { sha256 } from '../shared/hash.js';

/**
 * @param {string | Buffer | Uint8Array} currentContent
 * @param {string | undefined | null} expectedHash
 * @returns {string | null}
 */
export function assertExpectedSha256(currentContent, expectedHash) {
    if (!expectedHash) return null;
    const actualHash = sha256(currentContent);
    if (actualHash !== expectedHash) {
        const err = new Error(`expectedHash mismatch: expected ${expectedHash}, got ${actualHash}`);
        /** @type {{ code?: string; expectedHash?: string; actualHash?: string }} */ (err).code = 'EEXPECTEDHASH';
        /** @type {{ code?: string; expectedHash?: string; actualHash?: string }} */ (err).expectedHash = expectedHash;
        /** @type {{ code?: string; expectedHash?: string; actualHash?: string }} */ (err).actualHash = actualHash;
        throw err;
    }
    return actualHash;
}
