// @ts-check
/**
 * Canonical metadata for filesystem mutations that were physically applied before a later confirmation/durability step
 * failed. Callers must distinguish this state from a mutation that never reached its publish/write boundary.
 *
 * @module copilot/infra/io/fs/mutation-state
 */

/**
 * @typedef {Error & {
 *     mutationApplied?: boolean;
 *     mutationPhase?: string;
 *     mutationPath?: string;
 *     mutationPaths?: string[];
 *     suppressedErrors?: Error[];
 * }} MutationAppliedError
 */

/**
 * Normalize an arbitrary rejection value at the low-level filesystem boundary. This module deliberately does not import
 * higher layers merely to turn `unknown` into an Error.
 *
 * @param {unknown} error
 * @returns {Error}
 */
export function normalizeMutationError(error) {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Preserve the primary causal error while retaining a secondary cleanup/close failure for diagnostics.
 *
 * @param {unknown} primaryError
 * @param {unknown} suppressedError
 * @returns {Error}
 */
export function attachSuppressedMutationError(primaryError, suppressedError) {
    const primary = /** @type {MutationAppliedError} */ (normalizeMutationError(primaryError));
    const suppressed = normalizeMutationError(suppressedError);
    primary.suppressedErrors = [...(primary.suppressedErrors ?? []), suppressed];
    return primary;
}

/**
 * @param {unknown} error
 * @param {{ phase: string; paths?: readonly string[] }} details
 * @returns {MutationAppliedError}
 */
export function markMutationAppliedError(error, details) {
    const normalized = /** @type {MutationAppliedError} */ (normalizeMutationError(error));
    const paths = [...new Set((details.paths ?? []).filter((entry) => typeof entry === 'string' && entry.length > 0))];
    normalized.mutationApplied = true;
    normalized.mutationPhase = details.phase;
    const primaryPath = paths[0];
    if (primaryPath !== undefined) {
        normalized.mutationPath = primaryPath;
        normalized.mutationPaths = paths;
    }
    return normalized;
}

/**
 * @param {unknown} error
 * @returns {error is MutationAppliedError}
 */
export function isMutationAppliedError(error) {
    return Boolean(
        error && typeof error === 'object' && /** @type {MutationAppliedError} */ (error).mutationApplied === true,
    );
}

/**
 * @param {unknown} error
 * @returns {{ applied: boolean; phase: string | null; paths: string[] }}
 */
export function readMutationAppliedState(error) {
    if (!isMutationAppliedError(error)) return { applied: false, phase: null, paths: [] };
    const paths = Array.isArray(error.mutationPaths)
        ? error.mutationPaths.filter((entry) => typeof entry === 'string' && entry.length > 0)
        : typeof error.mutationPath === 'string' && error.mutationPath.length > 0
          ? [error.mutationPath]
          : [];
    return {
        applied: true,
        phase: typeof error.mutationPhase === 'string' ? error.mutationPhase : null,
        paths: [...new Set(paths)],
    };
}
