// @ts-check
/**
 * src/copilot/agent/lifecycle/index.js — sub-barrel do subsistema Lifecycle.
 *
 * @module copilot/agent/lifecycle
 * @see EventBus
 */

export {
    LIFECYCLE_MODULE_LAYOUT,
    getLifecycleModuleDescriptor,
    getLifecycleModuleRole,
    listLifecycleModulesByRole,
} from './module-map.js';
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
