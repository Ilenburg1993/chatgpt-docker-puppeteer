// @ts-check
/** @module copilot/infra/telemetry */

export { beginIoAdvisoryBudget, getIoAdvisoryBudgetStats } from './advisory-budget.js';
export { elapsedIoMs, nowIoMs } from './clock.js';
export { getIoDurabilityStats } from './durability.js';
export { getIoLatencyStats, recordIoLatency } from './latency.js';
export { getIoMutationStateStats } from './mutation-state.js';
export { publishIoLifecycleEvent, publishIoOperation, publishIoOperationResult } from './publisher.js';
