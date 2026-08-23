// @ts-check
/**
 * Snapshot validation boundary for index commits.
 *
 * @module copilot/infra/indexing/registry/sqlite/snapshot-verifier
 */

import { statPathSnapshot } from '#copilot/infra/internal/filesystem/read';
import { richFingerprintMatches } from '#copilot/infra/internal/platform/fingerprint';

/** @param {string} filePath @param {number} attempts */
export function createStaleIndexSnapshotError(filePath, attempts) {
    const error = /** @type {Error & { code?: string; attempts?: number }} */ (
        new Error(`Arquivo mudou antes do commit no índice: ${filePath}`)
    );
    error.code = 'ESTALEINDEXSNAPSHOT';
    error.attempts = attempts;
    return error;
}

/**
 * @param {{ onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void> }} [options]
 */
export function createIoIndexSnapshotVerifier(options = {}) {
    /**
     * @param {string} filePath
     * @param {{ sizeBytes: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }} snapshot
     * @param {{ action: string; attempt: number }} context
     */
    return async function assertCurrentFileSnapshot(filePath, snapshot, context) {
        await options.onPhase?.('before-file-commit-validation', {
            filePath,
            action: context.action,
            attempt: context.attempt,
        });
        let current;
        try {
            current = await statPathSnapshot(filePath);
        } catch {
            throw createStaleIndexSnapshotError(filePath, context.attempt);
        }
        if (
            !richFingerprintMatches(
                snapshot,
                {
                    sizeBytes: current.size,
                    mtimeMs: current.mtimeMs,
                    ctimeMs: current.ctimeMs,
                    dev: Number(current.dev),
                    ino: Number(current.ino),
                },
                { mtimeToleranceMs: 0 },
            )
        ) {
            throw createStaleIndexSnapshotError(filePath, context.attempt);
        }
    };
}
