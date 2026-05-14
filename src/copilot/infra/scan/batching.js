// @ts-check
/**
 * Primitivas de batching para scans de diretório.
 *
 * @module copilot/infra/scan/batching
 */

/**
 * @param {number} batchSize
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeBatchSize(batchSize, fallback) {
    return Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : fallback;
}

/**
 * @template T,U
 * @param {readonly T[]} items
 * @param {number} batchSize
 * @param {(item: T) => Promise<U>} mapper
 * @returns {Promise<U[]>}
 */
export async function mapInBatches(items, batchSize, mapper) {
    const safeBatchSize = normalizeBatchSize(batchSize, 1);
    /** @type {U[]} */
    const results = [];
    for (let start = 0; start < items.length; start += safeBatchSize) {
        const batch = items.slice(start, start + safeBatchSize);
        results.push(...(await Promise.all(batch.map((item) => mapper(item)))));
    }
    return results;
}
