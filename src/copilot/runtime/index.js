// @ts-check
/**
 * @module copilot/runtime
 * @file Ponto canônico de acoplamento operacional entre `agent` e o restante de `src/copilot`.
 *
 *   Fora de `agent/`, consumidores devem preferir `#copilot/runtime` para seleção de runtime, controles, dialog loop,
 *   projections operacionais e fluxos SDK compartilhados.
 */

export {
    createAgentRuntimeNotFoundError,
    getAgentRuntime,
    getAgentRuntimeOrDefault,
    getDefaultAgentRuntime,
    getDefaultAgentRuntimeId,
    isAgentRuntimeNotFoundError,
    listKnownAgentRuntimes,
    requireAgentRuntime,
    requireAgentRuntimeSelection,
    resolveAgentRuntimeId,
    resolveAgentRuntimeSelection,
} from '../presentation/agent/runtime/index.js';

export {
    abortAgentRuntimeCurrentMessage,
    answerAgentPendingQuestion,
    clearAgentPendingQuestionShadow,
    createAgentRuntimeSnapshot,
    getAgentHandoffManager,
    getAgentRuntimeControlStateForTarget,
    getAgentRuntimeControlsTarget,
    getDefaultAgentHandoffManager,
    getDefaultAgentRuntimeControlsTarget,
    listAgentRuntimeSnapshots,
    loadAgentRuntimeSnapshot,
    offAgentRuntimeEvent,
    onAgentRuntimeEvent,
    onceAgentRuntimeEvent,
    pauseAgentDialogLoop,
    pauseDefaultAgentDialogLoop,
    pingDefaultAgentDialogWatchdog,
    readAgentHandoffHistory,
    readAgentRuntimeControlState,
    readAgentRuntimeControlStateFromRoute,
    readAgentRuntimePermissionMode,
    readDefaultAgentHandoffHistory,
    resumeAgentDialogLoop,
    resumeDefaultAgentDialogLoop,
    saveAgentRuntimeSnapshot,
    setAgentRuntimePermissionMode,
    setDefaultAgentBackgroundCompactionThreshold,
    startAgentRuntime,
    steerAgentRuntimeMessage,
    stopAgentRuntime,
    stopAgentRuntimeDialogLoopAuthorized,
    stopDefaultAgentDialogLoopAuthorized,
} from '../presentation/runtime/controls.js';

export {
    MAX_EMBED_BYTES,
    attachmentToRuntimeEmbed,
    embedRuntimeMultiple,
    readRuntimeFileContext,
    sendRuntimeDialogTurn,
    sendRuntimeDialogTurnForRuntime,
    sendRuntimeDialogTurnOnActiveLoop,
    sendRuntimeDialogTurnOnActiveLoopDetailed,
    sendRuntimeDialogTurnWithDiagnostics,
    startRuntimeDialogLoop,
    stopRuntimeDialogLoopAuthorized,
} from '../presentation/runtime/dialog.js';

export {
    normalizeAgentContextWindowProjection,
    readAgentRuntimeOverview,
    readAgentRuntimeOverviewProjection,
    readDefaultAgentRuntimeOverview,
} from '../presentation/runtime/overview.js';
