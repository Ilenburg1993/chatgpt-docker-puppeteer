// @ts-check
/**
 * src/copilot/terminal/http-handlers.js
 *
 * @module copilot/terminal/http-handlers
 * @deprecated F33.1: Barrel de compatibilidade — usar imports diretos de handlers-agent.js, handlers-dialog.js e
 *   handlers-system.js. Este re-export será removido em versão futura.
 *
 *   Barrel re-export: mantém compatibilidade com consumidores existentes (route-table, server, commands). A lógica real
 *   agora vive em handlers-agent.js, handlers-dialog.js e handlers-system.js.
 */

export {
    handleAcceptHandoff,
    handleDialogPause,
    handleDialogResume,
    handleGetContext,
    handleGetHandoffs,
    handleInject,
    handlePipeline,
    handleRejectHandoff,
} from './handlers-agent.js';

export {
    handleDeleteMemory,
    handleHubHealth,
    handleListSessions,
    handleListTurns,
    handleRecallMemories,
    handleStoreMemory,
} from './handlers-dialog.js';

export {
    getInfiniteSessionConfig,
    getSseClientSets,
    handleDeleteCustomTool,
    handleGetAudit,
    handleGetConfig,
    handleGetCustomTools,
    handleGetErrors,
    handleGetHistory,
    handleGetPrBudget,
    handleGetQuota,
    handleGetSkills,
    handleGetToolStats,
    handleGetToolsConfig,
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
    handleHealth,
    handleMetrics,
    handleRegisterCustomTool,
    handleSetInfiniteSessionConfig,
    handleSetSkills,
    handleSetToolsConfig,
    handleSystemReset,
} from './handlers-system.js';
