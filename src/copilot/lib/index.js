// @ts-check
/**
 * src/copilot/lib/index.js
 *
 * Barrel de re-exportação para os módulos da camada lib do Copilot SDK. Permite importar de '#copilot/lib/index' em vez
 * de referenciar módulos individuais.
 *
 * Submódulos disponíveis:
 *
 * - client — gerenciamento do CopilotClient e registry de sessões
 * - hooks — factories de SessionHooks (createHooks, createAuditHooks, ...)
 * - permissions — factories de PermissionHandler (createApproveAllPermission, ...)
 * - session — operações de sessão (createSession, resumeOrCreate, ...)
 * - agents — factories de CustomAgentConfig (createAgent, createReadOnlyAgent, ...)
 * - models — helpers de modelos (listModels, pickModel, buildReasoningConfig, ...)
 * - tools-registry — registry de Custom Tools (createRegistry, registerTools, getAllTools, ...)
 * - telemetry — telemetria leve (createTelemetry, recordToolCall, getSummary, ...)
 *
 * @module copilot/lib
 */

export {
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
} from '#copilot/lib/client';

export {
    composePreToolUseHandlers,
    createAuditHooks,
    createDenyAllHooks,
    createErrorNotifierHook,
    createHooks,
    createMinimalHooks,
    createSafeHooks,
} from '#copilot/lib/hooks';

export {
    createApproveAllPermission,
    createAuditOnlyPermission,
    createPermissionHandler,
    createRestrictedPermission,
    createSafePermission,
} from '#copilot/lib/permissions';

export {
    createClientFromCliUrl,
    createSession,
    deleteSession,
    disconnectSession,
    listSessions,
    resumeOrCreate,
    resumeSession,
} from '#copilot/lib/session';

export {
    READ_ONLY_TOOLS,
    buildAgentList,
    createAgent,
    createAnalystAgent,
    createFullAccessAgent,
    createReadOnlyAgent,
    filterInferableAgents,
    isValidAgentName,
} from '#copilot/lib/agents';

export {
    buildReasoningConfig,
    filterEnabledModels,
    filterReasoningModels,
    filterVisionModels,
    getContextWindowSize,
    getModelById,
    getSupportedReasoningEfforts,
    indexModelsById,
    listModels,
    pickModel,
    resolveModelId,
    supportsReasoning,
} from '#copilot/lib/models';

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
} from '#copilot/lib/tools-registry';

export {
    clearTelemetry,
    createTelemetry,
    getAverageDuration,
    getCallsBySession,
    getCallsByTool,
    getErrorCalls,
    getErrorCount,
    getRecentCalls,
    getSuccessCount,
    getSummary,
    getTotalCalls,
    recordSessionEnd,
    recordSessionStart,
    recordToolCall,
} from '#copilot/lib/telemetry';
