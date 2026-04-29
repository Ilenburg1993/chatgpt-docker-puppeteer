// @ts-check
/**
 * src/copilot/agent/index.js — [L4] Core agent: AlwaysAlive, session, dialog.
 *
 * Barrel de exportação do módulo `src/copilot/agent/`. Centraliza os pontos de acesso públicos do agente.
 *
 * ### API pública (para uso externo)
 *
 * | Export             | Tipo      | Descrição                                  |
 * | ------------------ | --------- | ------------------------------------------ |
 * | `alwaysAliveAgent` | Singleton | Instância principal do agente AlwaysAlive  |
 * | `getAgent()`       | Function  | Accessor para o agente (lazy)              |
 * | `resetAgent()`     | Function  | Reinicia a instância lazy (testes/runtime) |
 * | `AlwaysAliveAgent` | Class     | Classe do agente (uso interno/testes)      |
 *
 * ### Subsistemas re-exportados
 *
 * - `dialog/` — DialogLoopManager, turn execution, backpressure, watchdog
 * - `infra/` — tools bootstrap, webhook, permission, task executor, handoff
 * - `lifecycle/` — bootstrap, connection, reconnect, state persistence
 * - `messaging/` — agent messaging facade
 * - `session/` — session initializer, event wiring, keepalive, rotation, cleanup
 * - `state/` — agent state management
 *
 * @module copilot/agent
 * @see EventBus
 */

// ── Raiz ─────────────────────────────────────────────────────
export {
    AGENT_EVENTS,
    DIALOG_LOOP_EVENTS,
    HIGH_FREQUENCY_EVENTS,
    PR_CONSUMING_EVENTS,
} from '../events/agent-events.js';
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent, resetAgent } from './always-alive.js';
export { classifyAgentError } from './error-policy.js';
export {
    DEFAULT_AGENT_RUNTIME_ID,
    clearAgentRuntimeRegistry,
    getDefaultAgentRuntimeId,
    getDefaultRegisteredAgentRuntime,
    getRegisteredAgentRuntime,
    hasAgentRuntime,
    listAgentRuntimes,
    registerAgentRuntime,
    setDefaultAgentRuntimeId,
    unregisterAgentRuntime,
} from './runtime-registry.js';
export {} from './types.js'; // re-exporta os typedefs: IAlwaysAliveAgent, AgentStatus, etc.

// ── Subsistemas ──────────────────────────────────────────────
export * from './dialog/index.js';
export {
    abortRuntimeCurrentMessage,
    answerRuntimePendingQuestion,
    clearRuntimePendingQuestionShadow,
    clearRuntimeSdkSessionOwnership,
    confirmSdkSessionUi,
    createRuntimeSnapshot,
    deleteAgentSdkPlan,
    getPendingSdkElicitation,
    getRuntimeHandoffHistory,
    getRuntimeHandoffManager,
    getSdkSessionCapabilities,
    inputSdkSessionUi,
    isSdkSessionUiElicitationAvailable,
    listAgentRuntimeWebhooks,
    listPendingSdkElicitations,
    listRuntimeSnapshots,
    listSdkCatalogModels,
    loadRuntimeSnapshot,
    offRuntimeEvent,
    onRuntimeEvent,
    onceRuntimeEvent,
    pauseRuntimeDialogLoop,
    persistAgentRuntimePendingQuestionState,
    readAgentRuntimeCapabilities,
    readAgentRuntimeHealthSnapshot,
    readAgentRuntimeSdkResourceSnapshot,
    readAgentRuntimeStatusSnapshot,
    readAgentRuntimeStatusValue,
    readAgentRuntimeTodoSummaries,
    readAgentRuntimeToolEntries,
    readAgentRuntimeTools,
    readAgentSdkPlan,
    readAgentSdkSessionMode,
    readRuntimeControlState,
    readRuntimeInteractionState,
    readRuntimeModelSelection,
    readRuntimePrBudgetSnapshot,
    readSdkModelMetadata,
    readSdkModelStats,
    recoverAgentDialogInputChannel,
    registerAgentRuntimeWebhook,
    resolvePendingSdkElicitation,
    resumeRuntimeDialogLoop,
    saveRuntimeSnapshot,
    selectSdkSessionUi,
    sendAgentDialogTurn,
    setAgentSdkSessionMode,
    setRuntimeBackgroundCompactionThreshold,
    setRuntimeModel,
    setRuntimeReasoningEffort,
    startAgentDialogLoop,
    startRuntime,
    stopAgentDialogLoopAuthorized,
    syncRuntimeSdkSessionOwnership,
    unregisterAgentRuntimeWebhook,
    updateAgentSdkPlan,
} from './facades/index.js';
export * from './health-check.js';
export * from './infra/index.js';
export * from './lifecycle/index.js';
export * from './messaging/index.js';
export * from './session/index.js';
export * from './state/index.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { ALWAYS_ALIVE_AGENT } from './di-tokens.js';
