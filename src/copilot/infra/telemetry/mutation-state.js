// @ts-check
/** Applied-but-unconfirmed mutation telemetry projection. */
import { readMutationAppliedState } from '#copilot/infra/internal/policy';

const mutationStateStats = {
    appliedButUnconfirmed: 0,
    /** @type {Map<string, number>} */
    byOperation: new Map(),
    /** @type {{ operation: string; phase: string | null; pathCount: number; at: number } | null} */
    last: null,
};

/** @param {import('#copilot/core/io-contracts').IoMeta} io @param {unknown} error */
export function recordIoMutationState(io, error) {
    const state = readMutationAppliedState(error);
    if (!state.applied) return;
    mutationStateStats.appliedButUnconfirmed += 1;
    mutationStateStats.byOperation.set(io.operation, (mutationStateStats.byOperation.get(io.operation) ?? 0) + 1);
    mutationStateStats.last = {
        operation: io.operation,
        phase: state.phase,
        pathCount: state.paths.length,
        at: Date.now(),
    };
}

export function getIoMutationStateStats() {
    return {
        appliedButUnconfirmed: mutationStateStats.appliedButUnconfirmed,
        byOperation: Object.fromEntries(mutationStateStats.byOperation),
        last: mutationStateStats.last ? { ...mutationStateStats.last } : null,
    };
}
