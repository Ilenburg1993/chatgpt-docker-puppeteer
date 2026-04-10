// @ts-check
/**
 * src/copilot/sdk/index.js
 *
 * Barrel de re-exportação para os módulos da camada SDK do Copilot.
 *
 * @module copilot/sdk
 */

export {
    CopilotClient,
    _injectClientForTest,
    _resetClientState,
    buildClientOptions,
    createClientSession,
    deleteClientSession,
    disconnectClientSession,
    forceStopClient,
    getActiveSessionCount,
    getAuthStatus,
    getClient,
    getClientSession,
    getClientState,
    getClientStatus,
    incrementSessionMessageCount,
    listActiveClientSessions,
    listAllClientSessions,
    listAvailableModels,
    pingClient,
    resumeClientSession,
    stopClient,
} from './client.js';

export {
    composePreToolUseHandlers,
    createAuditHooks,
    createDenyAllHooks,
    createErrorNotifierHook,
    createHooks,
    createMinimalHooks,
    createSafeHooks,
} from '#copilot/hooks/factory';

export {
    createApproveAllPermission,
    createAuditOnlyPermission,
    createPermissionHandler,
    createRestrictedPermission,
    createSafePermission,
} from '#copilot/hooks/permission';

export {
    createClientFromCliUrl,
    createSession,
    deleteSession,
    disconnectSession,
    listSessions,
    resumeOrCreate,
    resumeSession,
} from './session.js';

export {
    READ_ONLY_TOOLS,
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
    reloadAgents,
    selectAgent,
} from './agents.js';

export {
    AutoDowngradeDetector,
    ModelRegistry,
    ModelSelector,
    ModelStatsTracker,
    autoDowngradeDetector,
    modelRegistry,
    modelSelector,
    modelStatsTracker,
} from './models/registry.js';

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
    supportsReasoning,
} from './models/helpers.js';

export { raceEvents, waitForEvent } from './event-helpers.js';
export { httpRequest } from './http-request.js';
export { validateUrl, validateUrlString } from './url-validator.js';
export { pickDefined } from './utils.js';

// ─── Faixa 1: Types & Constants (rev.4) ──────────────────────────────────────
// types.js é puro JSDoc — não tem export runtime, consumers usam via import('./types.js')
export {
    CONNECTION_STATES,
    INFINITE_SESSION_DEFAULTS,
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
export { approveAll, createAllowlistPermissionHandler } from './permissions.js';
export { createTool, createToolSync, defineTool } from './tools.js';
// Nota: createPermissionHandler já exportado via #copilot/hooks/permission acima

// ─── Faixa 3: SystemMessage Builder (rev.4) ──────────────────────────────────
export {
    SYSTEM_PROMPT_SECTIONS,
    appendSystemMessage,
    appendToGuidelines,
    customizeSystemMessage,
    getSectionDescription,
    getSectionNames,
    replaceIdentity,
    replaceSystemMessage,
    sectionOverride,
    supportsCustomizeMode,
} from './system-message.js';

// ─── Faixa 4: Unified Config Builder (rev.4) ─────────────────────────────────
export {
    DEFAULT_DIAGNOSTIC_MODEL,
    DEFAULT_EXCLUDED_TOOLS,
    DEFAULT_INFINITE_SESSION,
    DEFAULT_MODEL,
    buildAlwaysAliveConfig,
    buildDiagnosticConfig,
    buildFullAccessConfig,
    buildReadOnlyConfig,
    buildSessionConfig,
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
} from './client-facade.js';
// Nota: buildConfig e getDefaults são aliases de buildSessionConfig e getProjectDefaults
// já exportados acima (Faixa 4) — não re-exportar para evitar duplicadas.

// ─── Faixa 6: Session Lifecycle Wrappers (rev.4) ─────────────────────────────
export {
    abortSession,
    disposeSession,
    getSessionMessages,
    getSessionWorkspacePath,
    runSessionLifecycle,
    setSessionModel,
} from './session-lifecycle.js';

// ─── Faixa 7: RPC Core Subsystems (rev.4) ────────────────────────────────────
export {
    commandsHandlePending,
    // Faixa 8: Advanced RPC subsystems
    compactionCompact,
    createSessionRpcFacade,
    modeGet,
    modeSet,
    modelGetCurrent,
    modelSwitchTo,
    permissionsHandlePending,
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
export { accountGetQuota, createServerRpcFacade, modelsList, ping, toolsList } from './server-rpc.js';

export {
    getAuthStatus as checkAuthStatus,
    fullHealthCheck,
    getQuota,
    getAuthStatus as healthGetAuthStatus,
    isServerReachable,
    pingCheck,
} from './health.js';

// ─── Faixa 21: Quota Monitor ──────────────────────────────────────────────────

export { createQuotaMonitor } from './quota-monitor.js';

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
} from './events.js';

// ─── Faixa 11: Session Lifecycle Events ───────────────────────────────────────

export {
    LIFECYCLE_EVENTS,
    isLifecycleEventType,
    onAllLifecycleEvents,
    onLifecycleEvent,
    onLifecycleEvents,
    onSessionBackground,
    onSessionCreated,
    onSessionDeleted,
    onSessionForeground,
    onSessionUpdated,
} from './client-events.js';

// ─── Faixa 12: Provider/BYOK Support ─────────────────────────────────────────

export {
    anthropicProvider,
    azureProvider,
    isValidProviderType,
    openaiProvider,
    validateProviderConfig,
} from './provider.js';

// ─── Faixa 13: Telemetry & Tracing ───────────────────────────────────────────

export {
    createFileTelemetry,
    createOtlpTelemetry,
    createStaticTraceProvider,
    createTelemetryConfig,
    getTraceContext,
} from './telemetry.js';

// ─── Faixa 16: Barrel Completeness ───────────────────────────────────────────

export {
    BUILTIN_HANDLER_MAP,
    _resetRegistry as _resetCustomToolsRegistry,
    buildCustomTools,
    getCustomToolDefinitions,
    loadCustomTools,
    loadCustomToolsAsync,
    registerCustomTool,
    removeCustomTool,
} from './custom-tools.js';

export { getToolsConfig, loadToolsConfig, loadToolsConfigAsync, patchToolsConfig } from './tools-state.js';

// ─── tools-registry.js — registry de ferramentas por sessão ─
export {
    createRegistry,
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
} from './tools-registry.js';

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
    agentGetStatus,
    agentList,
    agentSelect,
    agentStop,
    extensionsDisable,
    extensionsEnable,
    extensionsList,
    fleetStart,
    mcpDisable,
    mcpEnable,
    mcpGetStatus,
    mcpList,
    pluginsList,
    skillsDisable,
    skillsEnable,
    skillsGetStatus,
    skillsList,
} from './experimental-rpc.js';
