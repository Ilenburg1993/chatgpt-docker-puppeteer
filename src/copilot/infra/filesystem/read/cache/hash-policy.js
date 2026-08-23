// @ts-check
/** Stateless text hashing policy. Counters belong to an injected IoReadRuntime. @module copilot/infra/filesystem/read/cache/hash-policy */
import { sha256 } from '#copilot/infra/internal/platform/hash';

/** @typedef {'full' | 'returned' | 'none'} TextHashMode */
/** @param {unknown} value @returns {TextHashMode} */
export function normalizeTextHashMode(value) {
    return value === 'returned' || value === 'none' ? value : 'full';
}
/**
 * Resolve hashes without retaining process-wide counters/state.
 * @param {string} fullText
 * @param {string} returnedText
 * @param {boolean} fullWindow
 * @param {TextHashMode} hashMode
 * @param {string | undefined} knownFullHash
 */
export function resolveTextHashes(fullText, returnedText, fullWindow, hashMode, knownFullHash) {
    let reusableFullHash = knownFullHash;
    const ensureFullHash = () => (reusableFullHash ??= sha256(fullText));
    if (hashMode === 'full') {
        const contentHash = ensureFullHash();
        return {
            contentHash,
            returnedContentHash: fullWindow ? contentHash : sha256(returnedText),
            reusableFullHash,
        };
    }
    if (hashMode === 'returned') {
        return {
            contentHash: undefined,
            returnedContentHash: fullWindow ? ensureFullHash() : sha256(returnedText),
            reusableFullHash,
        };
    }
    return { contentHash: undefined, returnedContentHash: undefined, reusableFullHash };
}
