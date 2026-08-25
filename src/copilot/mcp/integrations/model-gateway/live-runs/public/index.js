// @ts-check
/** Public membrane for governed Model Gateway / LLM-B live-run execution. */

export {
    MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_KIND,
    MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION,
    createModelGatewayLiveRunEnvironmentAuthority,
} from '../environment.js';
/** @typedef {import('../environment.js').ModelGatewayLiveRunEnvironmentAuthority} ModelGatewayLiveRunEnvironmentAuthority */
export {
    MODEL_GATEWAY_LIVE_READINESS_SCRIPT,
    MODEL_GATEWAY_LIVE_RUNNER_SCRIPT,
    MODEL_GATEWAY_LIVE_RUNS_SCRIPT,
} from '../contracts.js';
export { buildModelGatewayLiveRunPlan } from '../plan.js';
export {
    MODEL_GATEWAY_LIVE_READINESS_CACHE_TTL_MS,
    executeModelGatewayLiveReadiness,
} from '../readiness.js';
export {
    DETACHED_LIVE_RUN_ID_RE,
    cancelDetachedLiveRun,
    inspectDetachedLiveRunCompletion,
    listDetachedLiveRuns,
    readDetachedLiveRunManifestById,
    readModelGatewayPersistedLiveRuns,
    reapCompletedDetachedLiveRuns,
    runModelGatewayLiveCommand,
    spawnDetachedLiveRun,
} from '../runtime.js';
