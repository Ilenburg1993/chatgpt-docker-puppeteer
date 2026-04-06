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
} from '#copilot/lib/sdk-client';

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
    AutoDowngradeDetector,
    ModelRegistry,
    ModelSelector,
    ModelStatsTracker,
    autoDowngradeDetector,
    modelRegistry,
    modelSelector,
    modelStatsTracker,
} from '#copilot/lib/model-registry';

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

export { raceEvents, waitForEvent } from './event-helpers.js';
export { httpRequest } from './http-request.js';
export { validateUrl, validateUrlString } from './url-validator.js';
export { pickDefined } from './utils.js';
