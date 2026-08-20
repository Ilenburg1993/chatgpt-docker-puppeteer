// @ts-check
/**
 * In-process MCP workspace smoke summary.
 *
 * @module copilot/mcp/control-plane/smoke-state
 */

/**
 * @typedef {{
 *     checkedAt: string;
 *     success: boolean;
 *     status: string;
 *     durationMs: number;
 *     checkCount: number;
 *     failedChecks: string[];
 *     warningCount: number;
 *     criticalCount: number;
 * }} McpWorkspaceSmokeSummary
 */

/** @type {McpWorkspaceSmokeSummary | null} */
let lastWorkspaceSmokeSummary = null;

/**
 * @param {McpWorkspaceSmokeSummary} summary
 * @returns {void}
 */
export function recordMcpWorkspaceSmokeSummary(summary) {
    lastWorkspaceSmokeSummary = { ...summary };
}

/**
 * @returns {McpWorkspaceSmokeSummary | null}
 */
export function readMcpWorkspaceSmokeSummary() {
    return lastWorkspaceSmokeSummary ? { ...lastWorkspaceSmokeSummary } : null;
}

/**
 * @returns {void}
 */
export function resetMcpWorkspaceSmokeSummaryForTests() {
    lastWorkspaceSmokeSummary = null;
}
