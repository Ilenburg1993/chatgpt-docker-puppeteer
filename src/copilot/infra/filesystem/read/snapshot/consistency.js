// @ts-check
/**
 * Shared snapshot/fingerprint primitives for consistent chunk reads and the progressive byte-line index.
 *
 * @module copilot/infra/filesystem/read/snapshot/consistency
 */

import { richFingerprintMatches } from '#copilot/infra/internal/platform/fingerprint';
import { sha256 } from '#copilot/infra/internal/platform/hash';

/**
 * @typedef {{
 *     sizeBytes: number;
 *     mtimeMs: number;
 *     ctimeMs: number;
 *     dev: number;
 *     ino: number;
 * }} ChunkSnapshotFingerprint
 */

/**
 * @param {import('node:fs').Stats} stats
 * @returns {ChunkSnapshotFingerprint}
 */
export function fingerprintFromStats(stats) {
    return {
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        dev: Number(stats.dev),
        ino: Number(stats.ino),
    };
}

/**
 * @param {ChunkSnapshotFingerprint} fingerprint
 * @returns {string}
 */
export function buildSnapshotVersion(fingerprint) {
    return sha256(
        `${fingerprint.dev}:${fingerprint.ino}:${fingerprint.sizeBytes}:${fingerprint.mtimeMs}:${fingerprint.ctimeMs}`,
    ).slice(0, 24);
}

/**
 * @param {ChunkSnapshotFingerprint} expected
 * @param {import('node:fs').Stats} stats
 * @returns {boolean}
 */
export function chunkSnapshotMatchesStats(expected, stats) {
    return richFingerprintMatches(expected, fingerprintFromStats(stats), { mtimeToleranceMs: 0 });
}

/**
 * @param {string} filePath
 * @param {number} attempts
 * @param {{ partial?: boolean; snapshotVersion?: string }} [details]
 * @returns {Error & { code?: string; attempts?: number; partial?: boolean; snapshotVersion?: string }}
 */
export function createStaleChunkSnapshotError(filePath, attempts, details = {}) {
    const error =
        /**
         * @type {Error & {
         *     code?: string;
         *     attempts?: number;
         *     partial?: boolean;
         *     snapshotVersion?: string;
         * }}
         */ (new Error(`Arquivo mudou durante leitura textual em chunks: ${filePath}`));
    error.code = details.partial ? 'ESTALECHUNKSTREAM' : 'ESTALECHUNKSNAPSHOT';
    error.attempts = attempts;
    error.partial = details.partial ?? false;
    if (details.snapshotVersion) error.snapshotVersion = details.snapshotVersion;
    return error;
}

/** @param {unknown} error */
export function isStaleChunkSnapshotError(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    return code === 'ESTALECHUNKSNAPSHOT' || code === 'ESTALECHUNKSTREAM';
}
