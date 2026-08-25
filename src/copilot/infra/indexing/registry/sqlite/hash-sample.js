// @ts-check
/** Bounded rotating content-hash verification for already-indexed files. */

import { readTextFileSnapshot, statPathSnapshot } from '#copilot/infra/internal/filesystem/read';
import { sha256 } from '#copilot/infra/internal/platform/hash';
import { buildIndexPathTreeRange, normalizeIndexPath } from './path/index.js';

const DEFAULT_HASH_SAMPLE_MAX_FILES = 8;
const HARD_MAX_HASH_SAMPLE_FILES = 128;

/**
 * @param {{
 *     stats: import('./types.js').IoIndexRuntimeStats;
 *     hashVerifyMaxBytes: number;
 *     stmtListHashVerificationCandidates: { all: Function };
 *     assertCurrentFileSnapshot: (filePath:string, snapshot:{sizeBytes:number;mtimeMs:number;ctimeMs:number;dev:number;ino:number}, context:{action:string;attempt:number})=>Promise<void>;
 * }} context
 */
export function createIoIndexHashSampleVerifier(context) {
    /**
     * Verify a bounded lexicographic slice and continue from `cursor` on the next invocation. The verifier never scans
     * the directory and never trusts metadata alone: every eligible sampled row is read and compared with its stored
     * content hash, then revalidated against the post-read filesystem snapshot before being accepted.
     *
     * @param {string} scopeRoot
     * @param {{ cursor?: string | null; maxFiles?: number; signal?: AbortSignal }} [options]
     */
    return async function verifyHashSample(scopeRoot, options = {}) {
        options.signal?.throwIfAborted();
        const startedAt = Date.now();
        const normalizedScope = normalizeIndexPath(scopeRoot);
        const range = buildIndexPathTreeRange(normalizedScope);
        const cursor = normalizeCursor(options.cursor);
        const maxFiles = normalizeMaxFiles(options.maxFiles);
        const firstRows = readCandidates(range, cursor, maxFiles);
        /** @type {HashCandidate[]} */
        const candidates = [...firstRows];
        let wrapped = false;
        if (cursor && candidates.length < maxFiles) {
            wrapped = true;
            const seen = new Set(candidates.map((row) => row.filePath));
            for (const row of readCandidates(range, '', maxFiles - candidates.length)) {
                if (seen.has(row.filePath)) continue;
                candidates.push(row);
                seen.add(row.filePath);
                if (candidates.length >= maxFiles) break;
            }
        }
        let hashVerifications = 0;
        let hashVerificationHits = 0;
        let hashVerificationMisses = 0;
        let metadataMismatches = 0;
        let errors = 0;
        /** @type {{ filePath: string; reason: string }[]} */
        const mismatches = [];
        for (const row of candidates) {
            options.signal?.throwIfAborted();
            try {
                const stat = await statPathSnapshot(row.filePath);
                if (!stat.isFile()) {
                    metadataMismatches += 1;
                    mismatches.push({ filePath: row.filePath, reason: 'not-a-file' });
                    continue;
                }
                if (stat.size !== row.sizeBytes) {
                    metadataMismatches += 1;
                    mismatches.push({ filePath: row.filePath, reason: 'size-changed' });
                    continue;
                }
                if (stat.size > context.hashVerifyMaxBytes) {
                    metadataMismatches += 1;
                    mismatches.push({ filePath: row.filePath, reason: 'hash-budget-exceeded-after-index' });
                    continue;
                }
                const snapshot = await readTextFileSnapshot(
                    row.filePath,
                    options.signal ? { signal: options.signal } : {},
                );
                options.signal?.throwIfAborted();
                hashVerifications += 1;
                context.stats.hashVerifications += 1;
                const currentHash = sha256(snapshot.content);
                await context.assertCurrentFileSnapshot(row.filePath, snapshot, {
                    action: 'bounded-hash-sample',
                    attempt: 1,
                });
                if (currentHash === row.contentHash) {
                    hashVerificationHits += 1;
                    context.stats.hashVerificationHits += 1;
                } else {
                    hashVerificationMisses += 1;
                    context.stats.hashVerificationMisses += 1;
                    mismatches.push({ filePath: row.filePath, reason: 'content-hash-mismatch' });
                }
            } catch (error) {
                options.signal?.throwIfAborted();
                errors += 1;
                context.stats.errors += 1;
                mismatches.push({
                    filePath: row.filePath,
                    reason:
                        error && typeof error === 'object' && 'code' in error
                            ? `read-error:${String(error.code ?? 'unknown')}`
                            : 'read-error',
                });
            }
        }
        const nextCursor = candidates.at(-1)?.filePath ?? cursor;
        return {
            available: true,
            scopeRoot: normalizedScope,
            cursor,
            nextCursor,
            maxFiles,
            candidateCount: candidates.length,
            wrapped,
            hashVerifications,
            hashVerificationHits,
            hashVerificationMisses,
            metadataMismatches,
            errors,
            mismatchCount: mismatches.length,
            mismatches,
            durationMs: Math.max(0, Date.now() - startedAt),
        };
    };

    /** @param {{ exact: string; descendantStart: string; descendantEnd: string }} range @param {string} cursor @param {number} limit */
    function readCandidates(range, cursor, limit) {
        if (limit <= 0) return /** @type {HashCandidate[]} */ ([]);
        return /** @type {HashCandidate[]} */ (
            context.stmtListHashVerificationCandidates.all(
                context.hashVerifyMaxBytes,
                range.exact,
                range.descendantStart,
                range.descendantEnd,
                cursor,
                limit,
            )
        );
    }
}

/** @typedef {{ filePath: string; sizeBytes: number; contentHash: string }} HashCandidate */

/** @param {unknown} value */
function normalizeCursor(value) {
    return typeof value === 'string' ? value : '';
}

/** @param {unknown} value */
function normalizeMaxFiles(value) {
    const parsed = Number(value ?? DEFAULT_HASH_SAMPLE_MAX_FILES);
    if (!Number.isFinite(parsed)) return DEFAULT_HASH_SAMPLE_MAX_FILES;
    return Math.min(HARD_MAX_HASH_SAMPLE_FILES, Math.max(0, Math.floor(parsed)));
}
