// @ts-check
/** Bounded per-path physical-size cache with non-sliding revalidation timestamps. */
import { stat } from 'node:fs/promises';

/** @param {unknown} error */
function errorCode(error) {
    return String(/** @type {{ code?: unknown }} */ (error)?.code ?? '');
}

/**
 * @param {{
 *   maxTrackedFiles: number;
 *   sizeRevalidateMs: number;
 *   readPhysicalSize?: (filePath:string)=>Promise<number>;
 * }} options
 */
export function createJsonlSizeTracker(options) {
    const readPhysicalSize = options.readPhysicalSize ?? (async (filePath) => (await stat(filePath)).size);
    /** @type {Map<string, { size: number; validatedAtMs: number }>} */
    const sizes = new Map();
    let cacheHits = 0;
    let statReads = 0;
    let externalCorrections = 0;

    /** @param {string} filePath */
    function touch(filePath) {
        const entry = sizes.get(filePath);
        if (!entry) return;
        sizes.delete(filePath);
        sizes.set(filePath, entry);
    }

    /** @param {string} filePath @param {number} size @param {{ physicallyValidated?: boolean }} [update] */
    function set(filePath, size, update = {}) {
        const previous = sizes.get(filePath);
        const validatedAtMs = update.physicallyValidated === true || !previous ? Date.now() : previous.validatedAtMs;
        sizes.delete(filePath);
        sizes.set(filePath, { size, validatedAtMs });
        while (sizes.size > options.maxTrackedFiles) {
            const oldest = sizes.keys().next().value;
            if (typeof oldest !== 'string') break;
            sizes.delete(oldest);
        }
    }

    /** @param {string} filePath */
    async function resolve(filePath) {
        const tracked = sizes.get(filePath);
        if (tracked && Date.now() - tracked.validatedAtMs < options.sizeRevalidateMs) {
            cacheHits += 1;
            touch(filePath);
            return tracked.size;
        }
        try {
            statReads += 1;
            const physicalSize = await readPhysicalSize(filePath);
            if (tracked && tracked.size !== physicalSize) externalCorrections += 1;
            set(filePath, physicalSize, { physicallyValidated: true });
            return physicalSize;
        } catch (error) {
            if (errorCode(error) !== 'ENOENT' && errorCode(error) !== 'ENOTDIR') throw error;
            if (tracked && tracked.size !== 0) externalCorrections += 1;
            set(filePath, 0, { physicallyValidated: true });
            return 0;
        }
    }

    /** @param {string} filePath */
    function discard(filePath) {
        sizes.delete(filePath);
    }

    function reset() {
        sizes.clear();
        cacheHits = 0;
        statReads = 0;
        externalCorrections = 0;
    }

    return Object.freeze({
        discard,
        resolve,
        reset,
        set,
        stats: () => ({
            trackedFiles: sizes.size,
            maxTrackedFiles: options.maxTrackedFiles,
            sizeRevalidateMs: options.sizeRevalidateMs,
            sizeCacheHits: cacheHits,
            sizeStatReads: statReads,
            sizeExternalCorrections: externalCorrections,
        }),
    });
}
