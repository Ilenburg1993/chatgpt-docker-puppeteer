// @ts-check
/**
 * src/copilot/terminal/handlers/index.js
 *
 * Barrel — re-exporta todos os handlers HTTP do Terminal Permanente LLM-B.
 *
 * @module copilot/terminal/handlers
 * @see EventBus
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
} from './agent.js';
export {
    handleDeleteMemory,
    handleHubHealth,
    handleListSessions,
    handleListTurns,
    handleRecallMemories,
    handleStoreMemory,
} from './dialog.js';
export * from './shared.js';
export {
    getInfiniteSessionConfig,
    getSseClientSets,
    handleDeleteCustomTool,
    handleGetConfig,
    handleGetCustomTools,
    handleGetSkills,
    handleGetToolsConfig,
    handleHealth,
    handleRegisterCustomTool,
    handleSetInfiniteSessionConfig,
    handleSetSkills,
    handleSetToolsConfig,
} from './system-config.js';
export {
    handleGetAudit,
    handleGetErrors,
    handleGetHistory,
    handleGetPrBudget,
    handleGetQuota,
    handleGetToolStats,
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
    handleMetrics,
    handleSystemReset,
} from './system-metrics.js';
