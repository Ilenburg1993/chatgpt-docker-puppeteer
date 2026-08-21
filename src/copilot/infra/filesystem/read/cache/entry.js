// @ts-check
/** Serialization and physical-fingerprint checks for read-cache entries. */

import { fingerprintMatches, richFingerprintMatches } from '#copilot/infra/internal/platform';

/** @param {unknown} metaJson @returns {Record<string, unknown>} */
export function parseCacheMetaJson(metaJson) {
    if (typeof metaJson !== 'string' || metaJson.trim() === '') return {};
    try {
        const parsed = JSON.parse(metaJson);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? /** @type {Record<string, unknown>} */ (parsed)
            : {};
    } catch {
        return {};
    }
}
/** @param {Record<string, unknown>} meta */
export function stringifyCacheMeta(meta) {
    return JSON.stringify(meta);
}
/** @param {Record<string, unknown>} meta */
export function readCacheContentHash(meta) {
    return typeof meta['contentHash'] === 'string' ? meta['contentHash'] : undefined;
}
/** @param {Record<string, unknown>} meta */
export function hasRichCacheFingerprint(meta) {
    return ['ctimeMs', 'dev', 'ino'].every((key) => typeof meta[key] === 'number' && Number.isFinite(meta[key]));
}
/**
 * @param {{ mtimeMs?: number | null; sizeBytes: number }} l2Entry
 * @param {Record<string, unknown>} l2Meta
 * @param {{ mtimeMs?: number; ctimeMs?: number; size?: number; dev?: number | bigint; ino?: number | bigint } | null} metadata
 */
export function l2EntryMatchesStat(l2Entry, l2Meta, metadata) {
    if (!metadata) return false;
    const basicMatches = fingerprintMatches(
        { mtimeMs: Number(l2Entry.mtimeMs), sizeBytes: Number(l2Entry.sizeBytes) },
        { mtimeMs: Number(metadata.mtimeMs), sizeBytes: Number(metadata.size) },
    );
    if (!basicMatches) return false;
    if (!hasRichCacheFingerprint(l2Meta)) return true;
    return richFingerprintMatches(
        {
            mtimeMs: Number(l2Entry.mtimeMs),
            ctimeMs: Number(l2Meta['ctimeMs']),
            sizeBytes: Number(l2Entry.sizeBytes),
            dev: Number(l2Meta['dev']),
            ino: Number(l2Meta['ino']),
        },
        {
            mtimeMs: Number(metadata.mtimeMs),
            ctimeMs: Number(metadata.ctimeMs),
            sizeBytes: Number(metadata.size),
            dev: Number(metadata.dev),
            ino: Number(metadata.ino),
        },
    );
}
