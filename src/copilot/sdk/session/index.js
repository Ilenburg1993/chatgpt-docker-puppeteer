// @ts-check
/**
 * src/copilot/sdk/session/index.js — Barrel canônico de `sdk/session/`
 *
 * Política 2.1: superfície explícita (runtime-only), evitando `export *` em módulos que carregam typedefs homônimos no
 * declaration emit (ex.: `CopilotSession`, `SessionConfig`).
 *
 * @module copilot/sdk/session
 */

export {
    blobAttachment,
    createBlobAttachment,
    createFileAttachment,
    directoryAttachment,
    fileAttachment,
    normalizeAttachments,
    selectionAttachment,
} from './attachments.js';

export {
    getSessionCapabilities,
    supportsElicitation,
    waitForElicitationCapability,
    watchCapabilities,
} from './capabilities.js';

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

export {
    ensureClient,
    isClientReady,
    quickDisconnect,
    quickResume,
    quickSession,
    shutdownClient,
    withEphemeralSession,
    withSession,
} from './client-facade.js';

export {
    ClientOptionsBuilder,
    buildCopilotClientOptionsFromEnv,
    buildServerCopilotClientOptions,
    buildTerminalCopilotClientOptions,
} from './client-options.js';

export {
    CopilotClient,
    CopilotClientManager,
    _injectClientForTest,
    _resetClientState,
    buildClientOptions,
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
    getClientSnapshot,
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
    sdkConnectionCircuitBreaker,
    setForegroundClientSessionId,
    startClient,
    stopClient,
} from './client.js';

export {
    isRuntimeElicitationSchema,
    normalizeElicitationContentWithSchema,
    normalizeElicitationResultWithSchema,
} from './elicitation-schema.js';
export {
    createQueuedElicitationHandler,
    normalizeElicitationCompletedEvent,
    normalizeElicitationPendingEvent,
    normalizeElicitationResult,
} from './elicitation.js';

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

export { HookBus, attachBus, defaultBus, normalizeHookInputForSdk10 } from './hook-bus.js';
export { clearHooksLogger, log, setHooksLogger } from './hook-logger.js';
export { HookRegistry, SDK_HOOKS } from './hook-registry.js';

export {
    normalizeMessageAttachments,
    normalizeMessageOptions,
    normalizeMessageRequestHeaders,
    summarizeMessageOptions,
} from './message-options.js';

export {
    createClientFromCliUrl,
    createSession,
    deleteSession,
    disconnectSession,
    listSessions,
    resumeOrCreate,
    resumeSession,
} from './lifecycle.js';

export { PermissionController, createConfiguredPermissionHandler } from './permission-controller.js';
export {
    classifyPermissionDecision,
    normalizePermissionCompletedEvent,
    normalizePermissionRequestedEvent,
} from './permission-events.js';
export {
    DEFAULT_PERMISSION_MODE,
    PERMISSION_MODES,
    TOOL_NAME_RE,
    extractPermissionToolName,
    normalizePermissionMode,
    sanitizeToolNames,
} from './permission-runtime.js';

export { approveAll, createAllowlistPermissionHandler, createPermissionHandler } from './permissions.js';

export {
    BYOK_ENV_KEYS,
    BYOK_SECRET_ENV_KEYS,
    anthropicProvider,
    azureProvider,
    buildConfiguredByokModelListHandler,
    discoverConfiguredByokModelsFromEnv,
    isValidProviderType,
    openaiProvider,
    readConfiguredByokModelDiscoveryCacheFromEnv,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokProfileSummaries,
    readConfiguredByokProfilesFromEnv,
    readConfiguredByokState,
    readConfiguredByokSummary,
    redactProviderConfig,
    resolveConfiguredByokSessionOverrides,
    validateProviderConfig,
} from './provider.js';
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
} from './session-events.js';

export {
    buildConfiguredClientSessionFsConfig,
    createLocalSessionFsProvider,
    createWorkspaceSessionFsHandler,
    describeConfiguredSessionFs,
    getConfiguredSessionFsHandler,
    getConfiguredSessionIdleTimeoutSeconds,
    readConfiguredSessionFsState,
} from './session-fs.js';

export {
    clearActiveSdkSessions,
    createSdkSessionRegistry,
    defaultSdkSessionRegistry,
    getActiveSdkSession,
    getActiveSdkSessionCount,
    incrementActiveSdkSessionMessageCount,
    listActiveSdkSessions,
    registerActiveSdkSession,
    removeActiveSdkSession,
} from './session-registry.js';

export {
    SYSTEM_MESSAGE_SECTIONS,
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
    transformSection,
} from './system-message.js';
export { ToolSessionContext, createToolSessionContext } from './tool-session-context.js';

// ui.js — exports explícitos: getSessionCapabilities já exportado por capabilities.js.
export {
    isSessionUiElicitationAvailable,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
} from './ui.js';

export {
    USER_INPUT_FREEFORM_POLICY,
    normalizeUserInputChoices,
    resolveEffectiveUserInputAllowFreeform,
} from './user-input-policy.js';

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
} from './user-input.js';

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
} from './runtime.js';

export { normalizeUserInputBridgeContract } from './user-input.js';
