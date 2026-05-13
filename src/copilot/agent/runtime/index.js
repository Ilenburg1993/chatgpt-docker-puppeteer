// @ts-check
/**
 * src/copilot/agent/runtime/index.js
 *
 * Barrel explícito do subdomínio runtime do agent.
 *
 * @module copilot/agent/runtime
 */

export {
    markAgentRuntimeDialogPausedForRecovery,
    persistAgentRuntimeDialogState,
    persistAgentRuntimePendingTurnState,
    readAgentRuntimeDialogBootstrapState,
    readAgentRuntimeDialogPersistedState,
    shouldScheduleAgentRuntimeDialogBootRecovery,
} from './dialog-runtime-state.js';

export {
    readRuntimeContextFactoryCapabilities,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimePermissionPolicySnapshot,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
    readRuntimeToolSessionContext,
} from './governance-readers.js';

export {
    clearAgentRuntimePendingQuestionShadow,
    persistAgentRuntimePendingQuestionState,
    shouldReapAgentRuntimePendingQuestionShadow,
} from './pending-question-state.js';

export { readAgentRuntimeSessionId, restoreAgentRuntimePersistentBootState } from './session-bootstrap-state.js';

export {
    persistAgentRuntimeGracefulShutdownState,
    persistAgentRuntimePrConsumptionSnapshot,
    resetAgentRuntimeGracefulShutdownFlag,
    saveAgentRuntimeShutdownSnapshot,
} from './shutdown-snapshot-state.js';

export {
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeSdkResourceSnapshot,
    readAgentRuntimeStatusSnapshot,
    readAgentRuntimeStatusValue,
} from './status-readers.js';
