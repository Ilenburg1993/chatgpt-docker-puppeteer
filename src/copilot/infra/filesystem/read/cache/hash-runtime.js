// @ts-check
/** Instance-owned text hashing counters. @module copilot/infra/filesystem/read/cache/hash-runtime */

import { sha256 } from '#copilot/infra/internal/platform';

/** @typedef {'full' | 'returned' | 'none'} TextHashMode */

export function createIoReadHashRuntime() {
    const stats = {
        reads: 0,
        hashComputations: 0,
        fullHashComputations: 0,
        returnedSliceHashComputations: 0,
        knownFullHashReuses: 0,
        fullWindowReturnedHashReuses: 0,
        fullHashOutputSkips: 0,
        returnedHashOutputSkips: 0,
    };

    return Object.freeze({
        stats() {
            return { ...stats };
        },
        reset() {
            for (const key of Object.keys(stats)) stats[/** @type {keyof typeof stats} */ (key)] = 0;
        },
        /**
         * @param {string} fullText
         * @param {string} returnedText
         * @param {boolean} fullWindow
         * @param {TextHashMode} hashMode
         * @param {string | undefined} knownFullHash
         */
        resolve(fullText, returnedText, fullWindow, hashMode, knownFullHash) {
            stats.reads += 1;
            let reusableFullHash = knownFullHash;
            let contentHash = /** @type {string | undefined} */ (undefined);
            let returnedContentHash = /** @type {string | undefined} */ (undefined);
            const ensureFullHash = () => {
                if (reusableFullHash) {
                    stats.knownFullHashReuses += 1;
                    return reusableFullHash;
                }
                reusableFullHash = sha256(fullText);
                stats.hashComputations += 1;
                stats.fullHashComputations += 1;
                return reusableFullHash;
            };
            if (hashMode === 'full') {
                contentHash = ensureFullHash();
                if (fullWindow) {
                    returnedContentHash = contentHash;
                    stats.fullWindowReturnedHashReuses += 1;
                } else {
                    returnedContentHash = sha256(returnedText);
                    stats.hashComputations += 1;
                    stats.returnedSliceHashComputations += 1;
                }
            } else if (hashMode === 'returned') {
                stats.fullHashOutputSkips += 1;
                if (fullWindow) {
                    returnedContentHash = ensureFullHash();
                    stats.fullWindowReturnedHashReuses += 1;
                } else {
                    returnedContentHash = sha256(returnedText);
                    stats.hashComputations += 1;
                    stats.returnedSliceHashComputations += 1;
                }
            } else {
                stats.fullHashOutputSkips += 1;
                stats.returnedHashOutputSkips += 1;
            }
            return { contentHash, returnedContentHash, reusableFullHash };
        },
        dispose() {
            for (const key of Object.keys(stats)) stats[/** @type {keyof typeof stats} */ (key)] = 0;
        },
    });
}
