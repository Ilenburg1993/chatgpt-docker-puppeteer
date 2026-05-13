// @ts-check
/**
 * src/copilot/agent/context/index.js
 *
 * Barrel explícito do subdomínio AgentContext.
 *
 * @module copilot/agent/context
 */

export { AgentContext } from '../agent-context.js';
export {
    clearPendingQuestion,
    clearPendingQuestionShadow,
    clearPendingSdkElicitation,
    getDialogLoopAttachedSnapshot,
    getPendingQuestionForStatusSnapshot,
    getPendingQuestionKind,
    getPendingQuestionShadowAgeMs,
    getPendingQuestionShadowExpiresAt,
    getPendingQuestionShadowKind,
    getPendingQuestionShadowRemainingMs,
    getPendingQuestionShadowSnapshot,
    getPendingQuestionShadowState,
    getPendingQuestionSnapshot,
    getPendingSdkElicitation,
    getSdkElicitationHandlerSnapshot,
    hasPendingQuestion,
    hasPendingQuestionShadow,
    isPendingQuestionShadowExpired,
    listPendingSdkElicitations,
    resolvePendingQuestion,
    resolvePendingSdkElicitation,
    setDialogLoopAttached,
    setPendingQuestion,
    setPendingQuestionShadow,
} from './agent-context-dialog-ops.js';
export {
    STATUS_TRANSITIONS,
    applyStatusTransition,
    getRuntimeStatus,
    isIdle,
    isProcessing,
    isStarting,
    isStatus,
    isStopped,
    isWaitingForInput,
    setRuntimeStatus,
} from './agent-context-fsm.js';
export {
    cacheStatusSnapshot,
    getFreshStatusSnapshotCache,
    getLastPrInfoSnapshot,
    getSendCountSnapshot,
    incrementSendCount,
    invalidateStatusSnapshot,
    setLastPrInfo,
    setSendCount,
} from './agent-context-metrics-ops.js';
export {
    clearAgentObserver,
    clearMcpReconnectCancel,
    clearMetricsTimer,
    clearQuotaMonitor,
    getAgentObserverSnapshot,
    getBootReportSnapshot,
    getMcpReconnectCancelSnapshot,
    getMetricsTimerSnapshot,
    getQuotaMonitorSnapshot,
    getStartReportSnapshot,
    setAgentObserver,
    setBootReport,
    setMcpReconnectCancel,
    setMetricsTimer,
    setQuotaMonitor,
    setStartReport,
    stopQuotaMonitor,
} from './agent-context-runtime-ops.js';
export {
    clearClient,
    clearSession,
    clearSessionEventUnsubscribers,
    getClientSnapshot,
    getContextStateSnapshot,
    getIsResumedSnapshot,
    getLastCheckpointPathSnapshot,
    getSessionEventUnsubscribersSnapshot,
    getSessionSnapshot,
    hasActiveSession,
    hasClient,
    isReconnectActive,
    setClient,
    setContextState,
    setIsResumed,
    setLastCheckpointPath,
    setReconnectState,
    setSession,
    setSessionEventUnsubscribers,
} from './agent-context-session-ops.js';
export {
    getPermissionHandlerSnapshot,
    getPermissionModeSnapshot,
    getPermissionPolicySnapshot,
    getToolRegistryEntriesSnapshot,
    getToolRegistrySnapshot,
    getToolSessionContext,
    setPermissionMode,
} from './agent-context-tool-ops.js';
export { asRecord, asStringArray, normalizeToolRegistryEntry } from './helpers/index.js';

export * as dialogOps from './agent-context-dialog-ops.js';
export * as fsmOps from './agent-context-fsm.js';
export * as metricsOps from './agent-context-metrics-ops.js';
export * as runtimeOps from './agent-context-runtime-ops.js';
export * as sessionOps from './agent-context-session-ops.js';
export * as toolOps from './agent-context-tool-ops.js';
