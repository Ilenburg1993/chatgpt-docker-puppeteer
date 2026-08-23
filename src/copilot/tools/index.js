// @ts-check
/**
 * src/copilot/tools/index.js
 *
 * Barrel canônico do subsistema `tools/`.
 *
 * Regra arquitetural: este arquivo deve permanecer **barrel-only** (sem estado, sem cache, sem lógica de composição).
 *
 * @module copilot/tools
 */

// ─── Typedef re-exports ───────────────────────────────────────────────────────

/** @typedef {import('./introspection/introspection-tools.js').AgentInfoProvider} AgentInfoProvider */

// ─── API de bootstrap/composição ──────────────────────────────────────────────
export {
    allTools,
    applySessionToolPermissionPolicy,
    bootstrapTools,
    configureHookTools,
    getAllStaticTools,
    getAllTools,
    hydrateCustomTools,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
    shouldSkipSdkPermissionPrompts,
} from './bootstrap.js';
export {
    TOOLS_MODULE_LAYOUT,
    buildToolsModuleScorecard,
    getToolsModuleDescriptor,
    getToolsModuleRole,
    listToolsModulesByRisk,
    listToolsModulesByRole,
} from './module-map.js';

// ─── Factory e contratos ──────────────────────────────────────────────────────
export { buildTool, withSkipPermission } from './infra/tool-factory.js';
export {
    classifyToolFailure,
    createToolFailureFeedback,
    createToolFailureResponse,
    createToolFailureResult,
    enrichToolFailureResult,
    isToolExecutionFailureResponse,
    isToolFailureResult,
    previewToolFeedbackValue,
    summarizeToolParameterSchema,
    withToolFailureFeedback,
} from './infra/tool-feedback.js';

// ─── Categorias de tools ──────────────────────────────────────────────────────
export { codeReadTools, codeTools, codeWriteTools } from './code/index.js';
export { WORKSPACE_ROOT, fileReadTools, fileTools, fileWriteTools, validatePath } from './file/index.js';
export { gitTools } from './git/index.js';
export {
    cancelAllUserInputRequests,
    getPendingInputIds,
    getPendingInputRequests,
    hasPendingUserInputRequests,
    hookTools,
    resolveUserInput,
} from './hook/index.js';
export { hubTools, resetHubForTests } from './hub/index.js';
export {
    createEmptyToolContractReport,
    getDisabledToolRecords,
    getDisabledTools,
    introspectionTools,
    isToolDisabled,
    readIntrospectionRegistrySnapshot,
    readToolContractReport,
    registerForIntrospection,
    resetIntrospectionStateForTests,
    setAgentInfoProvider,
    setSessionExcludedTools,
    verifyToolRegistryContracts,
} from './introspection/index.js';
export {
    modelGatewayCatalogRefreshTool,
    modelGatewayCatalogSearchTool,
    modelGatewayControlPlaneGuideTool,
    modelGatewayMaintenanceTool,
    modelGatewayModelEvaluateTool,
    modelGatewayModelSwitchTool,
    modelGatewayOperationStatusTool,
    modelGatewayOverviewTool,
    modelGatewayPolicyProposeTool,
    modelGatewayProbeExecuteTool,
    modelGatewayProbePlanTool,
    modelGatewayReadTools,
    modelGatewayRoutePlanTool,
    modelGatewayRouteSwitchTool,
    modelGatewayRuntimeReconcileTool,
    modelGatewayTools,
    modelGatewayWorkflowPlanTool,
    modelGatewayWriteTools,
    setModelGatewayRuntimeControl,
} from './model-gateway/index.js';
export { permissionTools } from './permission/index.js';
export {
    findSymbolUsagesTool,
    searchInFilesTool,
    searchTools,
    symbolSearchTools,
    workspaceSymbolSearchTool,
} from './search/index.js';
export { experimentalRpcTools, reloadAgentProcessTool, sessionRpcTools, sessionTools } from './session/index.js';
export { shellTools } from './shell/index.js';
export { taskTools } from './task/index.js';
export { todoReadTools, todoTools, todoWriteTools } from './todo/index.js';
export { resetWebToolsRateLimitWindowForTests, webTools } from './web/index.js';

// ─── Estado/infra compartilhada de tools ─────────────────────────────────────
export { clearToolsLogger, log, setToolsLogger } from './infra/logger.js';
export { clearToolsMetrics, getSummary, getToolStats, setToolsMetrics } from './infra/metrics-proxy.js';
export { readStore } from './todo/store.js';
