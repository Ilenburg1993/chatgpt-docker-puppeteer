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
export { tryReconnect } from './policies/reconnect-policy.js';
export {
    discoverRuntimePlugins,
    registerRuntimeAgentEventHost,
    registerRuntimeIpcHost,
    registerRuntimeProcessSignals,
    registerRuntimeShutdownHost,
    runCopilotSdkBootPreflight,
} from './process-host/runtime-host.js';
/**
 * @typedef {import('./process-host/runtime-host.js').CopilotSdkBootPreflightReport} CopilotSdkBootPreflightReport
 */
export {
    clearState,
    clearStateAsync,
    drainStateWrites,
    persistState,
    readState,
    readStateAsync,
    writeState,
    writeStateAsync,
} from './state/state-io.js';
