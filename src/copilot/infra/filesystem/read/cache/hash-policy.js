// @ts-check
/** Text hashing policy and observable digest-cost counters. */

import { sha256 } from '#copilot/infra/internal/platform';

/** @typedef {'full' | 'returned' | 'none'} TextHashMode */
const textHashStats = {
    reads: 0,
    hashComputations: 0,
    fullHashComputations: 0,
    returnedSliceHashComputations: 0,
    knownFullHashReuses: 0,
    fullWindowReturnedHashReuses: 0,
    fullHashOutputSkips: 0,
    returnedHashOutputSkips: 0,
};

export function getIoReadHashStats() {
    return { ...textHashStats };
}
export function resetIoReadHashStatsForTest() {
    for (const key of Object.keys(textHashStats)) textHashStats[/** @type {keyof typeof textHashStats} */ (key)] = 0;
}
/** @param {unknown} value @returns {TextHashMode} */
export function normalizeTextHashMode(value) {
    return value === 'returned' || value === 'none' ? value : 'full';
}

/**
 * @param {string} fullText
 * @param {string} returnedText
 * @param {boolean} fullWindow
 * @param {TextHashMode} hashMode
 * @param {string | undefined} knownFullHash
 */
export function resolveTextHashes(fullText, returnedText, fullWindow, hashMode, knownFullHash) {
    textHashStats.reads += 1;
    let reusableFullHash = knownFullHash;
    let contentHash = /** @type {string | undefined} */ (undefined);
    let returnedContentHash = /** @type {string | undefined} */ (undefined);
    const ensureFullHash = () => {
        if (reusableFullHash) {
            textHashStats.knownFullHashReuses += 1;
            return reusableFullHash;
        }
        reusableFullHash = sha256(fullText);
        textHashStats.hashComputations += 1;
        textHashStats.fullHashComputations += 1;
        return reusableFullHash;
    };
    if (hashMode === 'full') {
        contentHash = ensureFullHash();
        if (fullWindow) {
            returnedContentHash = contentHash;
            textHashStats.fullWindowReturnedHashReuses += 1;
        } else {
            returnedContentHash = sha256(returnedText);
            textHashStats.hashComputations += 1;
            textHashStats.returnedSliceHashComputations += 1;
        }
    } else if (hashMode === 'returned') {
        textHashStats.fullHashOutputSkips += 1;
        if (fullWindow) {
            returnedContentHash = ensureFullHash();
            textHashStats.fullWindowReturnedHashReuses += 1;
        } else {
            returnedContentHash = sha256(returnedText);
            textHashStats.hashComputations += 1;
            textHashStats.returnedSliceHashComputations += 1;
        }
    } else {
        textHashStats.fullHashOutputSkips += 1;
        textHashStats.returnedHashOutputSkips += 1;
    }
    return { contentHash, returnedContentHash, reusableFullHash };
}
