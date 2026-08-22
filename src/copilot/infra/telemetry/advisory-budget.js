// @ts-check
/** Instance-owned advisory IO pressure budget. @module copilot/infra/telemetry/advisory-budget */

import { readEnvPositiveInt } from '#copilot/infra/internal/platform';

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] */
export function readIoAdvisoryBudgetConfig(env = {}) {
    return Object.freeze({
        windowMs: readEnvPositiveInt('IO_ADVISORY_BUDGET_WINDOW_MS', 60_000, env),
        maxOperations: readEnvPositiveInt('IO_ADVISORY_BUDGET_MAX_OPERATIONS', 120, env),
        maxBytes: readEnvPositiveInt('IO_ADVISORY_BUDGET_MAX_BYTES', 64 * 1024 * 1024, env),
        maxActive: readEnvPositiveInt('IO_ADVISORY_BUDGET_MAX_ACTIVE', 12, env),
        eventCooldownMs: readEnvPositiveInt('IO_ADVISORY_BUDGET_EVENT_COOLDOWN_MS', 5_000, env),
    });
}

/** @param {{onPressure?:(operation:string,stats:ReturnType<ReturnType<typeof createIoAdvisoryBudgetRuntime>['stats']>)=>void;config?:ReturnType<typeof readIoAdvisoryBudgetConfig>}} [options] */
export function createIoAdvisoryBudgetRuntime(options = {}) {
    const { windowMs, maxOperations, maxBytes, maxActive, eventCooldownMs } =
        options.config ?? readIoAdvisoryBudgetConfig({});
    const maxSamples = 10_000;
    /** @type {{ id:number; at:number; operation:string; estimatedBytes:number }[]} */
    let samples = [];
    let active = 0;
    let nextId = 1;
    let lastPressureEventAt = 0;

    /** @param {number} now */
    function prune(now) {
        const cutoff = now - windowMs;
        let firstRetained = 0;
        while ((samples[firstRetained]?.at ?? Number.POSITIVE_INFINITY) < cutoff) firstRetained += 1;
        if (firstRetained > 0) samples = samples.slice(firstRetained);
        if (samples.length > maxSamples) samples = samples.slice(-maxSamples);
    }
    /** @param {number} now */
    function stats(now = Date.now()) {
        prune(now);
        const estimatedBytes = samples.reduce((total, sample) => total + sample.estimatedBytes, 0);
        /** @type {string[]} */ const reasons = [];
        if (samples.length > maxOperations) reasons.push('operations');
        if (estimatedBytes > maxBytes) reasons.push('bytes');
        if (active > maxActive) reasons.push('active');
        return Object.freeze({
            windowMs,
            operations: samples.length,
            estimatedBytes,
            active,
            pressure: reasons.length > 0,
            reasons: Object.freeze(reasons),
            limits: Object.freeze({ maxOperations, maxBytes, maxActive }),
        });
    }
    /** @param {{operation:string;estimatedBytes?:number;nowMs?:number}} input */
    function begin(input) {
        const now = input.nowMs ?? Date.now();
        const id = nextId++;
        const operation = String(input.operation || 'unknown').slice(0, 80);
        const estimatedBytes = Math.max(0, Math.trunc(Number(input.estimatedBytes) || 0));
        samples.push({ id, at: now, operation, estimatedBytes });
        active += 1;
        const current = stats(now);
        if (current.pressure && now - lastPressureEventAt >= eventCooldownMs) {
            lastPressureEventAt = now;
            options.onPressure?.(operation, current);
        }
        let finished = false;
        return Object.freeze({
            id,
            pressured: current.pressure,
            finish() {
                if (finished) return;
                finished = true;
                active = Math.max(0, active - 1);
            },
        });
    }
    function reset() {
        samples = [];
        active = 0;
        nextId = 1;
        lastPressureEventAt = 0;
    }
    return Object.freeze({ begin, stats, reset, dispose: reset });
}
