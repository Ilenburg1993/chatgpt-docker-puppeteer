// @ts-check
/**
 * Política pura para read-through de `read_file_content`.
 *
 * @module copilot/tools/file/read/read-through-policy
 */

/** @typedef {'off' | 'auto' | 'force'} ReadThroughMode */

export const DEFAULT_READ_THROUGH_AUTO_TIMEOUT_MS = 750;
export const DEFAULT_READ_THROUGH_FORCE_TIMEOUT_MS = 2_000;

/**
 * @param {unknown} value
 * @returns {ReadThroughMode}
 */
export function normalizeReadThroughMode(value) {
    if (value === false || value === 'off') return 'off';
    if (value === 'force') return 'force';
    return 'auto';
}

/**
 * @param {{ mode: ReadThroughMode; readStrategy: string; fileSize: number; minBytes: number }} input
 * @returns {{ attempted: boolean; mode: ReadThroughMode; skippedReason: string | null }}
 */
export function planReadThrough(input) {
    if (input.mode === 'off') return { attempted: false, mode: input.mode, skippedReason: 'disabled' };
    if (input.readStrategy !== 'cached') {
        return { attempted: false, mode: input.mode, skippedReason: 'non_cached_read_strategy' };
    }
    if (input.mode === 'force') return { attempted: true, mode: input.mode, skippedReason: null };
    if (input.fileSize < input.minBytes) return { attempted: false, mode: input.mode, skippedReason: 'file_below_threshold' };
    return { attempted: true, mode: input.mode, skippedReason: null };
}

/**
 * @param {ReadThroughMode} mode
 * @param {number} startedAt
 * @param {number} timeoutMs
 */
export function buildTimedOutReadThroughReport(mode, startedAt, timeoutMs) {
    return {
        attempted: true,
        mode,
        skippedReason: 'duration_budget_exceeded',
        timedOut: true,
        durationMs: Date.now() - startedAt,
        timeoutMs,
        indexed: false,
        relatedPaths: [],
    };
}

/**
 * @param {{ mode: ReadThroughMode; skippedReason: string | null; durationMs?: number }} input
 */
export function buildSkippedReadThroughReport(input) {
    return {
        attempted: false,
        mode: input.mode,
        skippedReason: input.skippedReason ?? 'unknown',
        durationMs: input.durationMs ?? 0,
        indexed: false,
        relatedPaths: [],
    };
}

/**
 * @param {ReadThroughMode} mode
 * @param {number} startedAt
 * @param {unknown} result
 */
export function buildAttemptedReadThroughReport(mode, startedAt, result) {
    const record = result && typeof result === 'object' && !Array.isArray(result) ? /** @type {Record<string, unknown>} */ (result) : {};
    const relatedPaths = Array.isArray(record['relatedPaths']) ? record['relatedPaths'].map(String) : [];
    return {
        ...record,
        attempted: true,
        mode,
        skippedReason: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        indexed: record['indexed'] === true || relatedPaths.length > 0,
        relatedPaths,
    };
}
