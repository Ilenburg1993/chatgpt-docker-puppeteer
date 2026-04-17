// @ts-check
/**
 * @module copilot/terminal/handlers-system-metrics
 * @file Adapter fino do terminal para a SSOT compartilhada de metrics, observability operacional, git/gh e quota.
 */

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
} from '../../presentation/system-metrics.js';
