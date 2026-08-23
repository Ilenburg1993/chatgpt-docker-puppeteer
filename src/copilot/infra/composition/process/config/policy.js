// @ts-check
/** Process-scoped application-independent policy snapshot parsed once by ProcessInfra composition. */
const DEFAULT_EVENT_BUS_MAX_COUNTERS = 1_000;

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env */
export function readProcessRuntimePolicyConfig(env) {
    const configured = Number(env['COPILOT_EVENT_BUS_MAX_COUNTERS'] ?? DEFAULT_EVENT_BUS_MAX_COUNTERS);
    const maxCounters = Number.isFinite(configured)
        ? Math.max(1, Math.trunc(configured))
        : DEFAULT_EVENT_BUS_MAX_COUNTERS;
    return Object.freeze({
        eventBus: Object.freeze({ maxCounters }),
    });
}
