// @ts-check
/**
 * Canonical lifecycle for one already-open filesystem handle.
 *
 * The operation result is not published until close succeeds. When both the operation and close fail, the operation
 * error remains primary and the close failure is attached as suppressed diagnostic context. Mutation-applied metadata
 * is preserved or added according to the caller-provided state probe.
 *
 * @module copilot/infra/filesystem/transaction/file-handle-lifecycle
 */

import {
    attachSuppressedMutationError,
    isMutationAppliedError,
    markMutationAppliedError,
    normalizeMutationError,
} from '#copilot/infra/internal/policy';

/**
 * @template T
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {() => Promise<T>} operation
 * @param {{
 *     mutationApplied?: () => boolean;
 *     operationPhase: string;
 *     closePhase: string;
 *     paths?: readonly string[];
 * }} options
 * @returns {Promise<T>}
 */
export async function runFileHandleOperation(handle, operation, options) {
    /** @type {T | undefined} */
    let result;
    /** @type {Error | null} */
    let pendingError = null;

    try {
        result = await operation();
    } catch (error) {
        pendingError = contextualizeFileHandleError(error, options.operationPhase, options);
    }

    try {
        await handle.close();
    } catch (error) {
        const closeError = contextualizeFileHandleError(error, options.closePhase, options);
        pendingError = pendingError === null ? closeError : attachSuppressedMutationError(pendingError, closeError);
    }

    if (pendingError !== null) throw pendingError;
    return /** @type {T} */ (result);
}

/**
 * @param {unknown} error
 * @param {string} phase
 * @param {{ mutationApplied?: () => boolean; paths?: readonly string[] }} options
 * @returns {Error}
 */
function contextualizeFileHandleError(error, phase, options) {
    if (isMutationAppliedError(error)) return error;
    const normalized = normalizeMutationError(error);
    return options.mutationApplied?.() === true
        ? markMutationAppliedError(normalized, { phase, paths: options.paths ?? [] })
        : normalized;
}
