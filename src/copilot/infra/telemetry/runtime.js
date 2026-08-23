// @ts-check
/** Thin runtime owner for independent IO telemetry facets. @module copilot/infra/telemetry/runtime */
import { createIoAdvisoryBudgetRuntime } from './advisory-budget.js';
import { createIoDurabilityRuntime } from './durability.js';
import { createIoLatencyRuntime } from './latency.js';
import { createIoMutationStateRuntime } from './mutation-state.js';

/** @param {{runtimeId?:string;advisoryBudgetConfig?:ReturnType<typeof import('./advisory-budget.js').readIoAdvisoryBudgetConfig>;onAdvisoryPressure?:(operation:string,stats:ReturnType<ReturnType<typeof createIoAdvisoryBudgetRuntime>['stats']>)=>void}} [options] */
export function createIoTelemetryRuntime(options = {}) {
    const runtimeId = options.runtimeId ?? 'io-telemetry-runtime';
    const advisoryBudget = createIoAdvisoryBudgetRuntime({
        ...(options.onAdvisoryPressure ? { onPressure: options.onAdvisoryPressure } : {}),
        ...(options.advisoryBudgetConfig ? { config: options.advisoryBudgetConfig } : {}),
    });
    const latency = createIoLatencyRuntime();
    const durability = createIoDurabilityRuntime();
    const mutationState = createIoMutationStateRuntime();
    let disposed = false;
    return Object.freeze({
        runtimeId,
        advisoryBudget,
        latency,
        durability,
        mutationState,
        /** @param {import('#copilot/infra/internal/operations/contracts').IoMeta} io @param {{success:boolean;error?:unknown}} opts */
        recordOperation(io, opts) {
            latency.record(io.operation, io.durationMs);
            durability.record(io);
            mutationState.record(io, opts.error);
        },
        snapshot() {
            return Object.freeze({
                runtimeId,
                disposed,
                advisoryBudget: advisoryBudget.stats(),
                latency: latency.stats(),
                durability: durability.stats(),
                mutationState: mutationState.stats(),
            });
        },
        reset() {
            advisoryBudget.reset();
            latency.reset();
            durability.reset();
            mutationState.reset();
        },
        dispose() {
            if (disposed) return;
            advisoryBudget.dispose();
            latency.dispose();
            durability.dispose();
            mutationState.dispose();
            disposed = true;
        },
    });
}
