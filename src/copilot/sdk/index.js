// @ts-check
/**
 * src/copilot/sdk/index.js
 *
 * Barrel de re-exportação para os módulos da camada SDK do Copilot.
 *
 * @module copilot/sdk
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
    filterInferableAgents,
    isValidAgentName,
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
} from './models/helpers.js';

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

export { raceEvents, waitForEvent } from './event-helpers.js';
export { httpRequest } from './http-request.js';
export { validateUrl, validateUrlString } from './url-validator.js';
export { pickDefined } from './utils.js';
