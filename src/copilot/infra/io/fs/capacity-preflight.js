// @ts-check
/**
 * Preflight advisory de capacidade para mutações que precisam materializar um payload no destino.
 *
 * `statfs` não reserva espaço e portanto não elimina corridas externas. A checagem falha aberta quando a plataforma
 * não oferece informação confiável, mas falha cedo com ENOSPC quando a insuficiência já é observável.
 *
 * @module copilot/infra/io/fs/capacity-preflight
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MIN_BYTES = 64 * 1024 * 1024;
const DEFAULT_RESERVE_BYTES = 64 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 1_000;
const MAX_CACHE_ENTRIES = 256;

/** @type {Map<string, { expiresAtMs: number; promise: ReturnType<typeof fs.statfs> }>} */
const statfsCache = new Map();
/** @type {WeakMap<Function, number>} */
let statfsFunctionIds = new WeakMap();
let nextStatfsFunctionId = 1;

/**
 * @param {string} key
 * @param {number} fallback
 */
function readNonNegativeIntegerEnv(key, fallback) {
    const raw = String(process.env[key] ?? '').trim();
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function getIoCapacityPreflightConfiguration() {
    const minBytes = readNonNegativeIntegerEnv('IO_CAPACITY_PREFLIGHT_MIN_BYTES', DEFAULT_MIN_BYTES);
    return {
        enabled: minBytes > 0,
        minBytes,
        reserveBytes: readNonNegativeIntegerEnv('IO_CAPACITY_PREFLIGHT_RESERVE_BYTES', DEFAULT_RESERVE_BYTES),
        cacheTtlMs: readNonNegativeIntegerEnv('IO_CAPACITY_PREFLIGHT_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS),
    };
}

/**
 * @param {typeof fs.statfs} statfs
 */
function getStatfsFunctionId(statfs) {
    let id = statfsFunctionIds.get(statfs);
    if (id === undefined) {
        id = nextStatfsFunctionId++;
        statfsFunctionIds.set(statfs, id);
    }
    return id;
}

/**
 * @param {string} directory
 * @param {typeof fs.statfs} statfs
 * @param {number} cacheTtlMs
 * @param {number} nowMs
 */
function readStatfsCached(directory, statfs, cacheTtlMs, nowMs) {
    if (cacheTtlMs <= 0) return statfs(directory, { bigint: true });
    const key = `${getStatfsFunctionId(statfs)}:${path.resolve(directory)}`;
    const cached = statfsCache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
        statfsCache.delete(key);
        statfsCache.set(key, cached);
        return cached.promise;
    }
    if (cached) statfsCache.delete(key);

    const promise = statfs(directory, { bigint: true });
    const entry = { expiresAtMs: nowMs + cacheTtlMs, promise };
    statfsCache.set(key, entry);
    void promise.catch(() => {
        if (statfsCache.get(key) === entry) statfsCache.delete(key);
    });
    while (statfsCache.size > MAX_CACHE_ENTRIES) {
        const oldest = statfsCache.keys().next().value;
        if (typeof oldest !== 'string') break;
        statfsCache.delete(oldest);
    }
    return promise;
}

/**
 * @param {bigint} value
 */
function boundedNumber(value) {
    return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
}

/**
 * @param {unknown} value
 */
function toNonNegativeBigInt(value) {
    if (typeof value === 'bigint') return value >= 0n ? value : 0n;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? BigInt(Math.floor(numeric)) : 0n;
}

/**
 * @typedef {{
 *     enabled: boolean;
 *     checked: boolean;
 *     sufficient: boolean | null;
 *     reason: 'disabled' | 'below-threshold' | 'sufficient' | 'insufficient' | 'statfs-unavailable';
 *     requiredBytes: number;
 *     reserveBytes: number;
 *     requiredWithReserveBytes: number;
 *     availableBytes: number | null;
 *     headroomBytes: number | null;
 *     errorCode?: string;
 * }} IoCapacityPreflightResult
 */

/**
 * @param {string} targetPath
 * @param {number} requiredBytes
 * @param {{
 *     minBytes?: number;
 *     reserveBytes?: number;
 *     cacheTtlMs?: number;
 *     nowMs?: number;
 *     statfs?: typeof fs.statfs;
 * }} [options]
 * @returns {Promise<IoCapacityPreflightResult>}
 */
export async function preflightIoCapacity(targetPath, requiredBytes, options = {}) {
    const configuration = getIoCapacityPreflightConfiguration();
    const minBytes = Math.max(0, Math.floor(options.minBytes ?? configuration.minBytes));
    const reserveBytes = Math.max(0, Math.floor(options.reserveBytes ?? configuration.reserveBytes));
    const cacheTtlMs = Math.max(0, Math.floor(options.cacheTtlMs ?? configuration.cacheTtlMs));
    const numericRequiredBytes = Number(requiredBytes);
    const normalizedRequiredBytes =
        Number.isFinite(numericRequiredBytes) && numericRequiredBytes > 0 ? Math.floor(numericRequiredBytes) : 0;
    const requiredWithReserveBytes = normalizedRequiredBytes + reserveBytes;
    const base = {
        enabled: minBytes > 0,
        requiredBytes: normalizedRequiredBytes,
        reserveBytes,
        requiredWithReserveBytes,
        availableBytes: null,
        headroomBytes: null,
    };

    if (minBytes === 0) {
        return { ...base, checked: false, sufficient: null, reason: 'disabled' };
    }
    if (normalizedRequiredBytes < minBytes) {
        return { ...base, checked: false, sufficient: null, reason: 'below-threshold' };
    }

    const statfs = options.statfs ?? fs.statfs;
    if (typeof statfs !== 'function') {
        return { ...base, checked: false, sufficient: null, reason: 'statfs-unavailable', errorCode: 'ENOSYS' };
    }

    try {
        const snapshot = await readStatfsCached(
            path.dirname(targetPath),
            statfs,
            cacheTtlMs,
            Math.trunc(options.nowMs ?? Date.now()),
        );
        const available = toNonNegativeBigInt(snapshot.bavail) * toNonNegativeBigInt(snapshot.bsize);
        const required = BigInt(requiredWithReserveBytes);
        const sufficient = available >= required;
        const report = {
            ...base,
            checked: true,
            sufficient,
            reason: /** @type {'sufficient' | 'insufficient'} */ (sufficient ? 'sufficient' : 'insufficient'),
            availableBytes: boundedNumber(available),
            headroomBytes: boundedNumber(available > required ? available - required : 0n),
        };
        if (!sufficient) {
            const error = new Error(
                `Espaço insuficiente no destino: necessário ${requiredWithReserveBytes} bytes, disponível ${report.availableBytes} bytes.`,
            );
            /** @type {{ code?: string; capacityPreflight?: IoCapacityPreflightResult }} */ (error).code = 'ENOSPC';
            /** @type {{ code?: string; capacityPreflight?: IoCapacityPreflightResult }} */ (error).capacityPreflight =
                report;
            throw error;
        }
        return report;
    } catch (error) {
        if (/** @type {{ code?: unknown }} */ (error)?.code === 'ENOSPC') throw error;
        return {
            ...base,
            checked: false,
            sufficient: null,
            reason: 'statfs-unavailable',
            errorCode: String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'UNKNOWN'),
        };
    }
}

export function resetIoCapacityPreflightCacheForTest() {
    statfsCache.clear();
    statfsFunctionIds = new WeakMap();
    nextStatfsFunctionId = 1;
}
