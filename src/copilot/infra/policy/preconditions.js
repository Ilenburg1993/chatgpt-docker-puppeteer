// @ts-check
/**
 * Preconditions reutilizáveis para mutações de I/O.
 *
 * @module copilot/infra/policy/preconditions
 */

import { sha256 } from '#copilot/infra/internal/platform/hash';

/**
 * @param {string} actualHash
 * @param {string | undefined | null} expectedHash
 * @returns {string | null}
 */
export function assertExpectedSha256Digest(actualHash, expectedHash) {
    if (!expectedHash) return null;
    if (actualHash !== expectedHash) {
        const err = new Error(`expectedHash mismatch: expected ${expectedHash}, got ${actualHash}`);
        /** @type {{ code?: string; expectedHash?: string; actualHash?: string }} */ (err).code = 'EEXPECTEDHASH';
        /** @type {{ code?: string; expectedHash?: string; actualHash?: string }} */ (err).expectedHash = expectedHash;
        /** @type {{ code?: string; expectedHash?: string; actualHash?: string }} */ (err).actualHash = actualHash;
        throw err;
    }
    return actualHash;
}

/**
 * @param {string | Buffer | Uint8Array} currentContent
 * @param {string | undefined | null} expectedHash
 * @returns {string | null}
 */
export function assertExpectedSha256(currentContent, expectedHash) {
    if (!expectedHash) return null;
    return assertExpectedSha256Digest(sha256(currentContent), expectedHash);
}
