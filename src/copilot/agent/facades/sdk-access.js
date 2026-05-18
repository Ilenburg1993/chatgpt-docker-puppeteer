// @ts-check
/**
 * src/copilot/agent/facades/sdk-access.js
 *
 * Barrel canônico de acesso ao SDK a partir das façades do agent.
 *
 * Decomposição realizada em W125 (2026-03-21): sdk/client.js — client, lifecycle events, handles, status ctx-wrapped
 * sdk/models.js — model registry, catálogo, stats, experimental sdk/tools.js — tools registry, configuração,
 * carregamento sdk/quota.js — quota monitor, rate-limit, recovery policy sdk/sessions.js — CRUD de sessões via client +
 * ctx-wrapped session ops sdk/workspace-ops.js — arquivos de workspace, shell, agentes customizados sdk/ui-ops.js — UI
 * elicitation, confirmações, inputs, permissões
 *
 * @module copilot/agent/facades/sdk-access
 * @see module:copilot/agent/facades/sdk/client
 * @see module:copilot/agent/facades/sdk/sessions
 * @see module:copilot/agent/facades/sdk/models
 * @see module:copilot/agent/facades/sdk/tools
 * @see module:copilot/agent/facades/sdk/quota
 * @see module:copilot/agent/facades/sdk/workspace-ops
 * @see module:copilot/agent/facades/sdk/ui-ops
 */

export {
    attachAgentSdkBootLifecycleBridge,
    checkAgentSdkAuthStatus,
    createAgentSdkClient,
    disconnectAgentSdkSession,
    ensureAgentSdkClientStarted,
    getAgentSdkLifecycleEvents,
    getAgentSdkSessionLifecycleEvents,
    getSdkAuthStatus,
    getSdkHandles,
    getSdkResourceSnapshot,
    getSdkStatus,
    listSdkBuiltInTools,
    listSdkModels,
    listSdkSkills,
    observeAgentSdkSessionLifecycle,
    onAgentSdkLifecycleEvents,
    pingAgentSdkClient,
    pingSdk,
    raceAgentSdkEvents,
    readSdkSkillsGovernance,
    setSdkDisabledSkills,
    stopAgentSdkClient,
} from './sdk/index.js';

export {
    AGENT_SDK_DEFAULT_MODEL,
    getAgentSdkModelStatsTracker,
    isAgentSdkExperimentalEnabled,
    listAgentSdkCatalogModels,
    readAgentSdkModelRegistryEntry,
    readAgentSdkModelStats,
} from './sdk/index.js';

export { formatValidationResult, validateAgentContracts } from './sdk/index.js';

export {
    createAgentSdkToolsRegistry,
    getAgentSdkToolsConfig,
    loadAgentSdkToolsConfigAsync,
    pickDefinedAgentSdkOptions,
} from './sdk/index.js';

export {
    createAgentSdkQuotaMonitor,
    getAgentSdkRecoveryPolicy,
    getSdkQuota,
    getSdkUsageMetrics,
    isAgentSdkQuotaOrRateLimitError,
    startAgentSdkBootQuotaBridge,
    startAgentSdkQuotaMonitor,
} from './sdk/index.js';

export {
    createAgentSdkSessionByClient,
    deleteAgentSdkSessionByClient,
    getAgentConfiguredSessionFsHandler,
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    listAgentSdkProtectedSessionIdsByClient,
    listAgentSdkSessionsByClient,
    listSdkSessions,
    resumeOrCreateAgentSdkSession,
    setForegroundSdkSessionId,
} from './sdk/index.js';

export {
    compactSdkSession,
    createSdkWorkspaceFile,
    deselectSdkAgent,
    execSdkShell,
    getCurrentSdkAgent,
    killSdkShell,
    listSdkAgents,
    listSdkWorkspaceFiles,
    readSdkWorkspaceFile,
    reloadSdkAgents,
    selectSdkAgent,
} from './sdk/index.js';

export {
    confirmSdkSessionUi,
    getPendingSdkElicitation,
    getSdkSessionCapabilities,
    handleSdkPendingCommand,
    handleSdkPendingPermission,
    handleSdkPendingToolCall,
    inputSdkSessionUi,
    isSdkSessionUiElicitationAvailable,
    listPendingSdkElicitations,
    listPendingSdkPermissions,
    loginSdkMcpOauth,
    requestSdkElicitation,
    resetSdkSessionApprovals,
    resolvePendingSdkElicitation,
    selectSdkSessionUi,
} from './sdk/index.js';

// Funções de leitura de mensagens de sessão SDK — fonte canônica: agent-sdk-runtime.js
export { canReadAgentSdkSessionMessages, readAgentSdkSessionMessages } from './agent-sdk-runtime.js';
