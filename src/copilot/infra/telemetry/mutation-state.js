// @ts-check
/** Instance-owned applied-but-unconfirmed mutation telemetry. @module copilot/infra/telemetry/mutation-state */
import { readMutationAppliedState } from '#copilot/infra/internal/policy';

export function createIoMutationStateRuntime() {
    let appliedButUnconfirmed = 0;
    /** @type {Map<string,number>} */ const byOperation = new Map();
    /** @type {{operation:string;phase:string|null;pathCount:number;at:number}|null} */ let last = null;
    /** @param {import('#copilot/core/io-contracts').IoMeta} io @param {unknown} error */
    function record(io, error) {
        const mutation = readMutationAppliedState(error);
        if (!mutation.applied) return;
        appliedButUnconfirmed += 1;
        byOperation.set(io.operation, (byOperation.get(io.operation) ?? 0) + 1);
        last = { operation: io.operation, phase: mutation.phase, pathCount: mutation.paths.length, at: Date.now() };
    }
    function stats() {
        return { appliedButUnconfirmed, byOperation: Object.fromEntries(byOperation), last: last ? { ...last } : null };
    }
    function reset() {
        appliedButUnconfirmed = 0;
        byOperation.clear();
        last = null;
    }
    return Object.freeze({ record, stats, reset, dispose: reset });
}
