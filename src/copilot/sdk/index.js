// @ts-check
/**
 * src/copilot/sdk/index.js — [L1] Wrapper @github/copilot-sdk. SSOT runtime + tipos.
 *
 * Barrel de re-exportação para a camada SDK do Copilot. ~120 exports organizados em faixas temáticas.
 *
 * ### Faixas de API
 *
 * | Faixa | Tema                       | Sub-módulo fonte      |
 * | ----- | -------------------------- | --------------------- |
 * | 1     | Types & Constants          | constants.js          |
 * | 2     | Tools & Permissions        | tools.js, permissions |
 * | 3     | SystemMessage Builder      | system-message.js     |
 * | 4     | Unified Config Builder     | config.js             |
 * | 5     | Client & Session Facade    | client-facade.js      |
 * | 6     | Session Lifecycle Wrappers | sdk-session-wrapper   |
 * | 7-8   | RPC Core & Advanced        | rpc.js, server-rpc    |
 * | 9     | Health & Auth              | health.js             |
 * | 10    | Event System               | events.js             |
 * | 11    | Lifecycle Events           | client-events.js      |
 * | 12    | Provider / BYOK            | provider.js           |
 * | 13    | Telemetry & Tracing        | telemetry.js          |
 * | 16    | Custom Tools Registry      | custom-tools.js       |
 * | 22    | Experimental Features      | feature-flags.js      |
 *
 * ### DI Setters (chamados por observability/bootstrap.js)
 *
 * - `setSdkLogger(logFn)` — injeta logger no módulo sdk
 * - `setCustomToolsBuilder(fn)` — injeta buildTool (late dep)
 *
 * @module copilot/sdk
 * @see EventBus
 */

import { createTool as createToolCore, createToolSync as createToolSyncCore } from './tools/core.js';

export {
    _injectClientForTest,
    _resetClientState,
    buildClientOptions,
    CopilotClient,
    CopilotClientManager,
    createClientSession,
    createCopilotClient,
    createCopilotClientManager,
    defaultClientManager,
    deleteClientSession,
    disconnectClientSession,
    forceStopClient,
    getActiveSessionCount,
    getAuthStatus,
    getClient,
    getClientSession,
    getClientState,
    getClientStatus,
    getForegroundClientSessionId,
    getLastClientSessionId,
    getSdkConnectionCircuitBreaker,
    getServerRpc,
    incrementSessionMessageCount,
    listActiveClientSessions,
    listAllClientSessions,
    listAvailableModels,
    pingClient,
    resumeClientSession,
    setForegroundClientSessionId,
    stopClient,
} from './session/client.js';

// Hook factory e permission removidos — consumidores devem importar de '#copilot/hooks' (L3), não via sdk (L1).
// Cf. PARTE-21C Faixa H: eliminação de violações L1→L3.

export {
    createClientFromCliUrl,
    createSession,
    deleteSession,
    disconnectSession,
    listSessions,
    resolveSessionCreateModel,
    resumeOrCreate,
    resumeSession,
    setSessionAutoModelResolver,
} from './session/lifecycle.js';

export {
    buildAgentList,
    createAgent,
    createAnalystAgent,
    createFullAccessAgent,
    createReadOnlyAgent,
    deselectAgent,
    filterInferableAgents,
    getCurrentAgent,
    isValidAgentName,
    listAgents,
    READ_ONLY_TOOLS,
    reloadAgents,
    selectAgent,
} from './agent/agents.js';

export {
    AutoDowngradeDetector,
    autoDowngradeDetector,
    createModelRuntime,
    defaultModelRuntime,
    ModelRegistry,
    modelRegistry,
    ModelSelector,
    modelSelector,
    ModelStatsTracker,
    modelStatsTracker,
} from './models/registry.js';

export {
    COPILOT_AUTO_MODEL_EXCLUDED_CLASSES,
    COPILOT_AUTO_MODEL_PUBLIC_CRITERIA,
    DEFAULT_AUTO_MODEL_PREFERENCE,
    describeAutoModelPolicy,
    readAutoModelPreference,
} from './models/auto-policy.js';

export {
    buildReasoningConfig,
    filterEnabledModels,
    filterModels,
    filterReasoningModels,
    filterVisionModels,
    getBillingMultiplier,
    getContextWindowSize,
    getDefaultReasoningEffort,
    getMaxContextTokens,
    getMaxPromptTokens,
    getModelById,
    getSupportedReasoningEfforts,
    getVisionMediaTypes,
    hasVision,
    indexModelsById,
    isModelEnabled,
    listModels,
    pickModel,
    resolveModelId,
    resolveModelIdAuto,
    supportsReasoning,
} from './models/helpers.js';

export {
    classifySdkError,
    classifySdkRateLimitScope,
    getSdkErrorFingerprint,
    getSdkRecoveryPolicy,
    isSdkQuotaOrRateLimitError,
    SdkOperationError,
} from './errors.js';
export { raceEvents, waitForEvent } from './event-helpers.js';
export { httpRequest } from './http-request.js';
export { pickDefined } from './utils.js';

// ─── Faixa 1: Types & Constants (rev.4) ──────────────────────────────────────
// types.js é puro JSDoc — não tem export runtime, consumers usam via import('./types.js')
export {
    CONNECTION_STATES,
    INFINITE_SESSION_DEFAULTS,
    PERMISSION_COMPLETED_KINDS,
    PERMISSION_RESULTS,
    PROVIDER_TYPES,
    REASONING_EFFORTS,
    SECTION_ACTIONS,
    SESSION_EVENTS,
    SESSION_LIFECYCLE_EVENTS,
    SESSION_MODES,
    SYSTEM_PROMPT_SECTION_NAMES,
    TOOL_RESULT_TYPES,
} from './constants.js';

// ─── Faixa 2: Tools & Permissions (rev.4) ────────────────────────────────────
export {
    createQueuedElicitationHandler,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
    normalizeElicitationResult,
} from './session/elicitation.js';
export {
    classifyPermissionDecision,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
} from './session/permission-events.js';
export { approveAll, createAllowlistPermissionHandler, createPermissionHandler } from './session/permissions.js';
export {
    normalizeModeChangedEvent,
    normalizeModelChangedEvent,
    normalizePlanChangedEvent,
    normalizeToolsUpdatedEvent,
} from './session/session-events.js';
export {
    classifyUserInputQuestionKind,
    createQueuedInputHandler,
    createReadlineInputHandler,
    createStaticInputHandler,
    normalizeUserInputCompletedEvent,
    normalizeUserInputRequestedEvent,
} from './session/user-input.js';
export { defineTool } from './tools/core.js';

/**
 * Hoist-safe facade para consumers que importam de `#copilot/sdk` durante ciclos ESM de tools.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {import('./tools/core.js').CreateToolOptions<T>} options
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
export function createTool(options) {
    return createToolCore(options);
}

/**
 * Variante síncrona da factory de tools, exposta pelo barrel canônico.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {Omit<import('./tools/core.js').CreateToolOptions<T>, 'parameters'> & {
 *     parameters?: Record<string, unknown>;
 * }} options
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
export function createToolSync(options) {
    return createToolSyncCore(options);
}

// ─── Faixa 3: SystemMessage Builder (rev.4) ──────────────────────────────────
export {
    appendSystemMessage,
    appendToGuidelines,
    customizeSystemMessage,
    getSectionDescription,
    getSectionNames,
    replaceIdentity,
    replaceSystemMessage,
    sectionOverride,
    supportsCustomizeMode,
    SYSTEM_PROMPT_SECTIONS,
    transformSection,
} from './session/system-message.js';

// ─── Faixa 4: Unified Config Builder (rev.4) ─────────────────────────────────
// Nota: DEFAULT_EXCLUDED_TOOLS, buildAlwaysAliveConfig, buildDiagnosticConfig,
// buildFullAccessConfig, buildReadOnlyConfig removidos — importar de '#copilot/config/session-config'.
// Cf. PARTE-21C Faixa H: eliminação de violações L1→L2.
export {
    buildSessionConfig,
    DEFAULT_DIAGNOSTIC_MODEL,
    DEFAULT_INFINITE_SESSION,
    DEFAULT_MODEL,
    getProjectDefaults,
    mergeExcludedTools,
    mergeTools,
} from './config.js';

// ─── Faixa 5: Client & Session Facade (rev.4) ────────────────────────────────
export {
    ensureClient,
    isClientReady,
    quickDisconnect,
    quickResume,
    quickSession,
    shutdownClient,
    withSession,
} from './session/client-facade.js';

export {
    blobAttachment,
    createBlobAttachment,
    createFileAttachment,
    directoryAttachment,
    fileAttachment,
    normalizeAttachments,
    selectionAttachment,
} from './session/attachments.js';

export { supportsElicitation, waitForElicitationCapability, watchCapabilities } from './session/capabilities.js';
// Nota: buildConfig e getDefaults são aliases de buildSessionConfig e getProjectDefaults
// já exportados acima (Faixa 4) — não re-exportar para evitar duplicadas.

// ─── Faixa 6: Session Lifecycle Wrappers (rev.4) ─────────────────────────────
export {
    abortSession,
    disconnectSessionSafe,
    disposeSession,
    getSessionMessages,
    getSessionWorkspacePath,
    runSessionLifecycle,
    sendSession,
    sendSessionAndWait,
    setSessionModel,
} from './session/wrapper.js';

export {
    getSessionCapabilities,
    isSessionUiElicitationAvailable,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
} from './session/ui.js';

export {
    buildConfiguredClientSessionFsConfig,
    createLocalSessionFsProvider,
    createWorkspaceSessionFsHandler,
    getConfiguredSessionFsHandler,
    getConfiguredSessionIdleTimeoutSeconds,
} from './session/session-fs.js';

// ─── Faixa 7: RPC Core Subsystems (rev.4) ────────────────────────────────────
export {
    commandsHandlePending,
    // Faixa 8: Advanced RPC subsystems
    compactionCompact,
    createSessionRpcFacade,
    instructionSourcesGet,
    modeGet,
    modelGetCurrent,
    modelSwitchTo,
    modeSet,
    permissionsHandlePending,
    permissionsListPending,
    planDelete,
    planRead,
    planUpdate,
    sessionLog,
    shellExec,
    shellKill,
    toolsHandlePendingCall,
    uiElicitation,
    workspaceCreateFile,
    workspaceListFiles,
    workspaceReadFile,
} from './rpc.js';

// ─── Faixa 9: Server RPC + Health ──────────────────────────────────────────────
export { accountGetQuota, createServerRpcFacade, modelsList, ping, toolsList } from './rpc/server.js';

export {
    getAuthStatus as checkAuthStatus,
    fullHealthCheck,
    getQuota,
    isServerReachable,
    pingCheck,
} from './telemetry/health.js';

// ─── Faixa 21: Quota Monitor ──────────────────────────────────────────────────

export { createQuotaMonitor } from './telemetry/quota-monitor.js';

// ─── Faixa 10: Event System Typed ─────────────────────────────────────────────

export {
    ALL_EVENT_TYPES,
    createEventFilter,
    getEventPayload,
    getEventType,
    isKnownEventType,
    onAllSessionEvents,
    onSessionEvent,
    onSessionEvents,
} from './session/events.js';

// ─── Faixa 11: Session Lifecycle Events ───────────────────────────────────────

export {
    isLifecycleEventType,
    LIFECYCLE_EVENTS,
    onAllLifecycleEvents,
    onLifecycleEvent,
    onLifecycleEvents,
    onSessionBackground,
    onSessionCreated,
    onSessionDeleted,
    onSessionForeground,
    onSessionUpdated,
} from './session/client-events.js';

// ─── Faixa 12: Provider/BYOK Support ─────────────────────────────────────────

export {
    anthropicProvider,
    azureProvider,
    isValidProviderType,
    openaiProvider,
    validateProviderConfig,
} from './session/provider.js';

// ─── Faixa 13: Telemetry & Tracing ───────────────────────────────────────────

export {
    createFileTelemetry,
    createOtlpTelemetry,
    createStaticTraceProvider,
    createTelemetryConfig,
    getTraceContext,
} from './telemetry/tracing.js';

// ─── Faixa 16: Barrel Completeness ───────────────────────────────────────────

export {
    _resetRegistry as _resetCustomToolsRegistry,
    buildCustomTools,
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    initCustomTools,
    loadCustomToolsAsync,
    registerCustomTool,
    removeCustomTool,
} from './tools/custom.js';

export { getToolsConfig, loadToolsConfigAsync, patchToolsConfig } from './tools/state.js';

// ─── tools-registry.js — registry de ferramentas por sessão ─
export {
    createRegistry,
    createToolRegistryAdapter,
    excludeByNames,
    filterByNames,
    getAllTools,
    getReadOnlyTools,
    getToolByName,
    getToolCount,
    getToolsByCategory,
    getToolsByTag,
    hasToolByName,
    inspectRegistry,
    listToolNames,
    mergeRegistries,
    registerTool,
    registerTools,
} from './tools/registry.js';

// ─── Faixa 22: Experimental Features (gated) ─────────────────────────────────

export {
    EXPERIMENTAL_FEATURES,
    getExperimentalFlags,
    isExperimentalEnabled,
    resetExperimentalFlags,
    setExperimentalFlag,
} from './feature-flags.js';

export {
    agentDeselect,
    agentGetCurrent,
    agentList,
    agentReload,
    agentSelect,
    extensionsDisable,
    extensionsEnable,
    extensionsList,
    extensionsReload,
    fleetStart,
    mcpDisable,
    mcpEnable,
    mcpList,
    mcpReload,
    pluginsList,
    skillsDisable,
    skillsEnable,
    skillsList,
    skillsReload,
} from './rpc/experimental.js';

export { setSdkLogger } from './logger.js';
export { emitSdkOperationMetric, setSdkMetricEmitter } from './telemetry/operation-metrics.js';
export { setCustomToolsBuilder } from './tools/custom.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
export { SDK_CLIENT_MANAGER, SDK_LOGGER, SDK_MODEL_RUNTIME, TOOLS_BUILDER } from './di-tokens.js';
