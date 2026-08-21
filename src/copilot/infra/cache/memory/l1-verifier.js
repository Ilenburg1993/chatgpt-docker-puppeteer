// @ts-check
/** Rich fingerprint/hash verification of one L1 cache entry against current filesystem state. */
import { fingerprintMatches, richFingerprintMatches, sha256 } from '#copilot/infra/internal/platform';
import * as fs from 'node:fs/promises';
import { IO_L1_HASH_REVALIDATE_MAX_BYTES, IO_L1_STALE_PROBE_INTERVAL_MS } from './l1-policy.js';
/** @typedef {import('./cache-types.js').IoCacheEntry} IoCacheEntry */
/**
 * @param {IoCacheEntry} entry
 * @param {string} filePath
 * @returns {Promise<{fresh:boolean;hashRevalidated:boolean;hashRevalidationHit:boolean}>}
 */
export async function verifyIoL1EntrySnapshot(entry, filePath) {
    if (IO_L1_STALE_PROBE_INTERVAL_MS < 0 || entry.mtime === undefined || entry.size === undefined)
        return { fresh: true, hashRevalidated: false, hashRevalidationHit: false };
    const now = Date.now();
    if (now - (entry.lastValidatedAt ?? entry.cachedAt) < IO_L1_STALE_PROBE_INTERVAL_MS)
        return { fresh: true, hashRevalidated: false, hashRevalidationHit: false };
    try {
        const stat = await fs.stat(filePath);
        const currentMtime = stat.mtimeMs;
        const currentSize = stat.size;
        const hasRichFingerprint =
            Number.isFinite(entry.ctime) && Number.isFinite(entry.dev) && Number.isFinite(entry.ino);
        const fresh = hasRichFingerprint
            ? richFingerprintMatches(
                  {
                      mtimeMs: entry.mtime,
                      ctimeMs: Number(entry.ctime),
                      sizeBytes: entry.size,
                      dev: Number(entry.dev),
                      ino: Number(entry.ino),
                  },
                  {
                      mtimeMs: currentMtime,
                      ctimeMs: stat.ctimeMs,
                      sizeBytes: currentSize,
                      dev: Number(stat.dev),
                      ino: Number(stat.ino),
                  },
              )
            : fingerprintMatches(
                  { mtimeMs: entry.mtime, sizeBytes: entry.size },
                  { mtimeMs: currentMtime, sizeBytes: currentSize },
              );
        if (!fresh) {
            const hashEligible =
                typeof entry.contentHash === 'string' &&
                currentSize === entry.size &&
                currentSize <= IO_L1_HASH_REVALIDATE_MAX_BYTES;
            if (hashEligible) {
                try {
                    const actualHash = sha256(await fs.readFile(filePath));
                    if (actualHash === entry.contentHash) {
                        entry.mtime = currentMtime;
                        entry.size = currentSize;
                        entry.ctime = stat.ctimeMs;
                        entry.dev = Number(stat.dev);
                        entry.ino = Number(stat.ino);
                        entry.lastValidatedAt = now;
                        entry.fingerprintStrategy = 'mtime-size-ctime-dev-ino-hash';
                        return { fresh: true, hashRevalidated: true, hashRevalidationHit: true };
                    }
                } catch {
                    return { fresh: false, hashRevalidated: true, hashRevalidationHit: false };
                }
                return { fresh: false, hashRevalidated: true, hashRevalidationHit: false };
            }
            return { fresh: false, hashRevalidated: false, hashRevalidationHit: false };
        }
        entry.lastValidatedAt = now;
        entry.fingerprintStrategy = hasRichFingerprint ? 'mtime-size-ctime-dev-ino' : 'mtime-size';
        return { fresh: true, hashRevalidated: false, hashRevalidationHit: false };
    } catch {
        return { fresh: false, hashRevalidated: false, hashRevalidationHit: false };
    }
}
