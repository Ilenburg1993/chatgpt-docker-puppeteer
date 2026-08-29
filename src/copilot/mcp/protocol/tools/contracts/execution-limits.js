// @ts-check
/**
 * Canonical execution envelopes shared by MCP tool schemas, runtime guards and capability guidance. Keep these values
 * free of tool-module imports so every consumer can depend on one direction only.
 *
 * @module copilot/mcp/protocol/tools/contracts/execution-limits
 */

export const MCP_TOOL_EXECUTION_LIMITS_VERSION = 6;

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
        defaultTreeMaxEntries: 2000,
        maxTreeMaxEntries: 5000,
        defaultTreeContentBudgetBytes: 512 * 1024,
        minTreeContentBudgetBytes: 16 * 1024,
        maxTreeContentBudgetBytes: 1024 * 1024,
        maxTreeToolResultBytes: 1536 * 1024,
        maxTreeEnumeratedEntries: 100_000,
        defaultChunkLines: 200,
        maxChunkLines: 1000,
        defaultChunkMaxChunks: 4,
        maxChunkMaxChunks: 64,
        defaultChunkContentBudgetBytes: 512 * 1024,
        minChunkContentBudgetBytes: 16 * 1024,
        maxChunkContentBudgetBytes: 1024 * 1024,
        maxChunkToolResultBytes: 1536 * 1024,
        defaultInventoryMaxResults: 2000,
        maxInventoryMaxResults: 5000,
        defaultInventoryContentBudgetBytes: 512 * 1024,
        minInventoryContentBudgetBytes: 16 * 1024,
        maxInventoryContentBudgetBytes: 1024 * 1024,
        maxInventoryToolResultBytes: 1536 * 1024,
        defaultOutlineMaxItems: 500,
        maxOutlineMaxItems: 5000,
        defaultOutlineContentBudgetBytes: 512 * 1024,
        minOutlineContentBudgetBytes: 16 * 1024,
        maxOutlineContentBudgetBytes: 1024 * 1024,
        maxOutlineToolResultBytes: 1536 * 1024,
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
