// @ts-check
/**
 * src/copilot/sdk/index.js — [L1] Wrapper @github/copilot-sdk. SSOT runtime + tipos.
 *
 * Barrel de re-exportação para a camada SDK do Copilot. ~120 exports organizados em faixas temáticas.
 *
 * ### Faixas de API
 *
 * | Faixa | Tema                      | Sub-módulo fonte       |
 * | ----- | ------------------------- | ---------------------- |
 * | 1     | Types & Constants         | constants.js           |
 * | 2     | Tools & Permissions       | tools.js, permissions  |
 * | 3     | SystemMessage Builder     | system-message.js      |
 * | 4     | Client & Session Facade   | client-facade.js       |
 * | 5     | Session Runtime Lifecycle | session-runtime        |
 * | 6-7   | RPC Core & Advanced       | rpc/index + rpc-facade |
 * | 8     | Health & Auth             | health.js              |
 * | 9     | Event System              | events.js              |
 * | 10    | Lifecycle Events          | client-events.js       |
 * | 11    | Provider / BYOK           | provider.js            |
 * | 12    | Telemetry & Tracing       | telemetry.js           |
 * | 15    | Custom Tools Registry     | custom-tools.js        |
 * | 21    | Experimental Features     | feature-flags.js       |
 *
 * ### DI Setters (chamados por observability/bootstrap.js)
 *
 * - `setSdkLogger(logFn)` — injeta logger no módulo sdk
 * - `setCustomToolsBuilder(fn)` — injeta buildTool (late dep)
 *
 * @module copilot/sdk
 * @see EventBus
 */

import {
    createDeclarationTool as createDeclarationToolCore,
    createTool as createToolCore,
    createToolSync as createToolSyncCore,
} from './tools/core.js';

export {
    _injectClientForTest,
    _resetClientState,
    buildClientOptions,
    CopilotClient,
    CopilotClientManager,
    createClientSession,
    createCopilotClient,
    createCopilotClientManager,
    createServerCopilotClient,
    createTerminalCopilotClient,
    defaultClientManager,
    deleteClientSession,
    disconnectClientSession,
    forceStopClient,
    getActiveSessionCount,
    getAuthStatus,
    getClient,
    getClientSession,
    getClientSessionMetadata,
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
    listModels,
    pingClient,
    resumeClientSession,
    setForegroundClientSessionId,
    startClient,
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
    pickModel,
    resolveModelId,
    resolveModelIdAuto,
    supportsReasoning,
} from './models/helpers.js';

export {
    classifySdkError,
    classifySdkRateLimitScope,
    decideModelCallAutoFallback,
    decideModelCallErrorHandling,
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
    DEFAULT_DIAGNOSTIC_MODEL,
    DEFAULT_MODEL,
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
export { attachBus, defaultBus as defaultHookBus, HookBus } from './session/hook-bus.js';
export { clearHooksLogger, setHooksLogger } from './session/hook-logger.js';
export { HookRegistry, SDK_HOOKS } from './session/hook-registry.js';
export { createConfiguredPermissionHandler, PermissionController } from './session/permission-controller.js';
export {
    classifyPermissionDecision,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
} from './session/permission-events.js';
export {
    DEFAULT_PERMISSION_MODE,
    normalizePermissionMode,
    PERMISSION_MODES,
    TOOL_NAME_RE as PERMISSION_TOOL_NAME_RE,
    sanitizeToolNames as sanitizePermissionToolNames,
} from './session/permission-runtime.js';
export { approveAll, createAllowlistPermissionHandler, createPermissionHandler } from './session/permissions.js';
export {
    normalizeCanvasOpenedEvent,
    normalizeCanvasRegistryChangedEvent,
    normalizeHookProgressEvent,
    normalizeModeChangedEvent,
    normalizeModelCallFailureEvent,
    normalizeModelChangedEvent,
    normalizePermissionsChangedEvent,
    normalizePlanChangedEvent,
    normalizeToolsUpdatedEvent,
} from './session/session-events.js';
export { createToolSessionContext, ToolSessionContext } from './session/tool-session-context.js';
export {
    normalizeUserInputChoices,
    resolveEffectiveUserInputAllowFreeform,
    USER_INPUT_FREEFORM_POLICY,
} from './session/user-input-policy.js';
export {
    cancelAllPendingStructuredUserInput,
    classifyUserInputQuestionKind,
    configureDefaultUserInputContext,
    createQueuedInputHandler,
    createReadlineInputHandler,
    createStaticInputHandler,
    deletePendingStructuredUserInputResolver,
    getPendingStructuredUserInputCount,
    getPendingStructuredUserInputIds,
    getPendingStructuredUserInputRequests,
    hasPendingStructuredUserInputRequests,
    nextStructuredUserInputRequestId,
    normalizeUserInputCompletedEvent,
    normalizeUserInputRequestedEvent,
    registerPendingStructuredUserInputResolver,
    resolvePendingStructuredUserInput,
} from './session/user-input.js';
export { AgentToolPolicy } from './tools/agent-policy.js';
export {
    BuiltInTools,
    convertMcpCallToolResult,
    defineTool,
    normalizeToolParametersSchema,
    normalizeToolTelemetry,
    ToolSet,
} from './tools/core.js';

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
 * Factory para tools declaration-only do SDK 1.0.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {import('./tools/core.js').CreateDeclarationToolOptions<T>} options
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
export function createDeclarationTool(options) {
    return createDeclarationToolCore(options);
}

/**
 * Variante síncrona da factory de tools, exposta pelo barrel canônico.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {import('./tools/core.js').CreateToolOptions<T>} options
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
    SYSTEM_MESSAGE_SECTIONS,
    SYSTEM_PROMPT_SECTIONS,
    transformSection,
} from './session/system-message.js';

// Configuração de sessão é canônica em '#copilot/config' via SessionConfigBuilder.
// O SDK root não reexporta builders de configuração para manter L1 livre de regras de produto L2.

// ─── Faixa 4: Client & Session Facade (rev.4) ────────────────────────────────
export {
    ensureClient,
    isClientReady,
    quickDisconnect,
    quickResume,
    quickSession,
    shutdownClient,
    withEphemeralSession,
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
export {
    normalizeMessageAttachments,
    normalizeMessageOptions,
    normalizeMessageRequestHeaders,
    summarizeMessageOptions,
} from './session/message-options.js';
// ─── Faixa 5: Session Lifecycle Wrappers (rev.4) ─────────────────────────────
export {
    abortSession,
    disconnectSessionSafe,
    disposeSession,
    getSessionMessages,
    getSessionWorkspacePath,
    logSessionTimeline,
    runSessionLifecycle,
    sendSession,
    sendSessionAndWait,
    setSessionModel,
} from './session/runtime.js';

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
    describeConfiguredSessionFs,
    getConfiguredSessionFsHandler,
    getConfiguredSessionIdleTimeoutSeconds,
    readConfiguredSessionFsState,
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
    nameGet,
    nameSet,
    permissionsHandlePending,
    permissionsListPending,
    permissionsResetSessionApprovals,
    permissionsSetApproveAll,
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
} from './rpc/index.js';

// ─── Faixa 9: Server RPC + Health ──────────────────────────────────────────────
export {
    accountGetQuota,
    createServerRpcFacade,
    mcpConfigAdd,
    mcpConfigDisable,
    mcpConfigEnable,
    mcpConfigList,
    mcpConfigRemove,
    mcpConfigUpdate,
    mcpDiscover,
    modelsList,
    ping,
    sessionsFork,
    skillsConfigSetDisabledSkills,
    skillsDiscover,
    toolsList,
} from './rpc/server.js';

export {
    getAuthStatus as checkAuthStatus,
    fullHealthCheck,
    getQuota,
    isServerReachable,
    pingCheck,
} from './telemetry/health.js';
export { runCopilotSdkBootPreflight } from './telemetry/preflight.js';

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
    buildConfiguredByokModelListHandler,
    BYOK_ENV_KEYS,
    BYOK_SECRET_ENV_KEYS,
    discoverConfiguredByokModelsFromEnv,
    isValidProviderType,
    openaiProvider,
    readConfiguredByokModelDiscoveryCacheFromEnv,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokProfilesFromEnv,
    readConfiguredByokProfileSummaries,
    readConfiguredByokState,
    readConfiguredByokSummary,
    redactProviderConfig,
    resolveConfiguredByokSessionOverrides,
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

// ─── Faixa 22: Experimental Flags (gated) ────────────────────────────────────

export {
    EXPERIMENTAL_FEATURES,
    getExperimentalFlags,
    isExperimentalEnabled,
    resetExperimentalFlags,
    setExperimentalFlag,
} from './feature-flags.js';

export { setSdkLogger } from './logger.js';
export { emitSdkOperationMetric, setSdkMetricEmitter } from './telemetry/operation-metrics.js';
export { setCustomToolsBuilder } from './tools/custom.js';

// ─── DI Tokens ────────────────────────────────────────────────────────────────
