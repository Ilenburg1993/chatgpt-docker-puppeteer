// @ts-check
/** Failure annotation without rereading mutable filesystem state. */

/**
 * Attach the exact locked/virtual state identity that produced a patch failure without rereading the file.
 *
 * @param {unknown} error
 * @param {string} currentHash
 * @param {number} currentBytes
 * @param {{ currentStateKind?: 'locked-file' | 'virtual-batch'; diskBaselineHash?: string; diskBaselineBytes?: number }} [context]
 */
export function annotatePatchRecoveryState(error, currentHash, currentBytes, context = {}) {
    if (!error || typeof error !== 'object') return error;
    const target = /** @type {Error & { details?: Record<string, unknown> }} */ (error);
    const details =
        target.details && typeof target.details === 'object' && !Array.isArray(target.details) ? target.details : {};
    target.details = {
        ...details,
        currentHash,
        currentBytes,
        currentStateKind: context.currentStateKind ?? 'locked-file',
        ...(context.diskBaselineHash ? { diskBaselineHash: context.diskBaselineHash } : {}),
        ...(Number.isFinite(context.diskBaselineBytes) ? { diskBaselineBytes: context.diskBaselineBytes } : {}),
    };
    return target;
}

/**
 * Preserve the original patch error while attaching precise batch-local failure context.
 *
 * @param {unknown} error
 * @param {number} operationIndex
 * @param {number} completedOperationCount
 * @param {'baseline-hash' | 'operation' | 'result-validation'} failurePhase
 */
export function annotatePatchBatchOperationError(error, operationIndex, completedOperationCount, failurePhase) {
    const target =
        error instanceof Error
            ? /** @type {Error & { operationIndex?: number; completedOperationCount?: number; failurePhase?: string }} */ (
                  error
              )
            : /** @type {Error & { operationIndex?: number; completedOperationCount?: number; failurePhase?: string }} */ (
                  new Error(String(error), { cause: error })
              );
    target.operationIndex = operationIndex;
    target.completedOperationCount = completedOperationCount;
    target.failurePhase = failurePhase;
    return target;
}
