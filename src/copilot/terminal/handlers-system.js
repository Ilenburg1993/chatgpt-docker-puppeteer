// @ts-check
/**
 * src/copilot/terminal/handlers-system.js
 *
 * Shim de compatibilidade — re-exporta de `handlers/system-config.js` e `handlers/system-metrics.js`.
 *
 * @module copilot/terminal/handlers-system
 */

export {
    getSseClientSets,
    getInfiniteSessionConfig,
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
} from './handlers/system-config.js';

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
} from './handlers/system-metrics.js';
