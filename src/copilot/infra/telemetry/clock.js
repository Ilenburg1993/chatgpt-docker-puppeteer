// @ts-check
/** Monotonic timing helpers shared by IO telemetry producers. */
import { performance } from 'node:perf_hooks';

export function nowIoMs() {
    return performance.now();
}

/** @param {number} startedAt */
export function elapsedIoMs(startedAt) {
    return Math.max(0, Math.round(nowIoMs() - startedAt));
}
