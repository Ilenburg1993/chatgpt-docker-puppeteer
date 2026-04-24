// @ts-check
/**
 * src/copilot/agent/lifecycle/index.js — sub-barrel do subsistema Lifecycle.
 *
 * @module copilot/agent/lifecycle
 * @see EventBus
 */

export { tryReconnect } from './reconnect-policy.js';
export {
    discoverRuntimePlugins,
    registerRuntimeAgentEventHost,
    registerRuntimeIpcHost,
    registerRuntimeProcessSignals,
    registerRuntimeShutdownHost,
    runCopilotSdkBootPreflight,
} from './runtime-host.js';
export {
    clearState,
    clearStateAsync,
    drainStateWrites,
    persistState,
    readState,
    readStateAsync,
    writeState,
    writeStateAsync,
} from './state-io.js';
