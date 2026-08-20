// @ts-check
/**
 * Canonical execution envelopes shared by MCP tool schemas, runtime guards and capability guidance. Keep these values
 * free of tool-module imports so every consumer can depend on one direction only.
 *
 * @module copilot/mcp/control-plane/tool-capabilities
 */

export const MCP_TOOL_EXECUTION_LIMITS_VERSION = 2;

export const MCP_TOOL_EXECUTION_LIMITS = Object.freeze({
    toolsList: Object.freeze({
        maxEnvelopeBytes: 400 * 1024,
    }),
    terminal: Object.freeze({
        maxBatchCommands: 32,
        maxBatchConcurrency: 16,
        maxSessions: 128,
        maxExecOutputBytes: 16 * 1024 * 1024,
        maxSessionBufferBytes: 64 * 1024 * 1024,
        maxSessionReadBytes: 8 * 1024 * 1024,
    }),
    repoRead: Object.freeze({
        maxBatchRequests: 64,
        defaultBatchConcurrency: 6,
        maxBatchConcurrency: 8,
        maxBatchInputBytes: 2 * 1024 * 1024,
        defaultBatchResultBudgetBytes: 2 * 1024 * 1024,
        minBatchResultBudgetBytes: 64 * 1024,
        maxBatchResultBudgetBytes: 3 * 1024 * 1024,
        maxSearchContextLines: 48,
    }),
    repoPatch: Object.freeze({
        maxBatchOperations: 128,
        maxBatchTargets: 64,
        maxBatchInputBytes: 3 * 1024 * 1024,
        defaultPlanConcurrency: 4,
        defaultFastConcurrency: 4,
        maxTargetConcurrency: 8,
        defaultApplyMode: 'per-target-fast',
        defaultFailureMode: 'best-effort',
    }),
    repoFileBatch: Object.freeze({
        maxOperations: 64,
        safeDefaultApplyMode: 'sequential-fast',
        destructiveDefaultApplyMode: 'global-preflight',
    }),
    validator: Object.freeze({
        maxBatchRequests: 8,
        maxBatchConcurrency: 1,
        acceptedInputMaxConcurrency: 2,
    }),
});
