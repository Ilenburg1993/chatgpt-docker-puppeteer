// @ts-check
/**
 * src/copilot/terminal/http-handlers.js
 *
 * Barrel re-export: mantém compatibilidade com consumidores existentes (route-table, server, commands). A lógica real
 * agora vive em handlers-agent.js, handlers-dialog.js e handlers-system.js.
 *
 * @module copilot/terminal/http-handlers
 */

export {
    handleDialogPause,
    handleDialogResume,
    handleGetContext,
    handleInject,
    handlePipeline,
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
