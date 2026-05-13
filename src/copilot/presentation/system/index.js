// @ts-check
/**
 * Barrel público do subdomínio `presentation/system`.
 *
 * @module copilot/presentation/system
 */

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
} from './config.js';
export {
    handleGetAudit,
    handleGetErrors,
    handleGetHistory,
    handleGetPrBudget,
    handleGetQuota,
    handleGetThinkingEntry,
    handleGetThinkingHistory,
    handleGetToolStats,
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
    handleMetrics,
    handleSystemReset,
    readToolStatsProjection,
} from './metrics/index.js';
