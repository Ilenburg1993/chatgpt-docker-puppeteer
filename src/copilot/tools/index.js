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
    bootstrapTools,
    configureHookTools,
    getAllStaticTools,
    getAllTools,
    setExperimentalSession,
    setHub,
    setPermissionAgent,
    setSessionRpc,
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
    createToolFailureResult,
    createToolFailureResponse,
    enrichToolFailureResult,
    isToolFailureResult,
    previewToolFeedbackValue,
    summarizeToolParameterSchema,
    withToolFailureFeedback,
} from './infra/tool-feedback.js';

// ─── Categorias de tools ──────────────────────────────────────────────────────
export { codeTools } from './code/index.js';
export { fileReadTools, fileTools, fileWriteTools } from './file/index.js';
export {
    findSymbolUsagesTool,
    searchInFilesTool,
    searchTools,
    symbolSearchTools,
    workspaceSymbolSearchTool,
} from './search/index.js';
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
    getDisabledTools,
    introspectionTools,
    isToolDisabled,
    readIntrospectionRegistrySnapshot,
    readToolContractReport,
    registerForIntrospection,
    resetIntrospectionStateForTests,
    setAgentInfoProvider,
    verifyToolRegistryContracts,
} from './introspection/index.js';
export { permissionTools } from './permission/index.js';
export { experimentalRpcTools, reloadAgentProcessTool, sessionRpcTools, sessionTools } from './session/index.js';
export { shellTools } from './shell/index.js';
export { taskTools } from './task/index.js';
export { todoReadTools, todoTools, todoWriteTools } from './todo/index.js';
export { resetWebToolsRateLimitWindowForTests, webTools } from './web/index.js';

// ─── Estado/infra compartilhada de tools ─────────────────────────────────────
export { TOOLS_LOGGER, TOOLS_METRICS } from './infra/di-tokens.js';
export { clearToolsLogger, log, setToolsLogger } from './infra/logger.js';
export { clearToolsMetrics, getSummary, getToolStats, setToolsMetrics } from './infra/metrics-proxy.js';
export { readStore } from './todo/store.js';
