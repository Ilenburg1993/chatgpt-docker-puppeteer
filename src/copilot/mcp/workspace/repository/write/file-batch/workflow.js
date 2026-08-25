// @ts-check
/** File-batch execution state machine independent from MCP result presentation. */

import { applyBatchFileOperation, resolveFileBatchApplyMode, runFileBatchPreflight } from './runtime.js';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */

/**
 * @param {RepoWriteRuntime} runtime
 * @param {Record<string, unknown>[]} operations
 * @param {{ dryRun: boolean; applyMode?: 'global-preflight' | 'sequential-fast' }} options
 */
export async function executeRepoFileBatchWorkflow(runtime, operations, options) {
    const startedAt = performance.now();
    const applyModeDecision = resolveFileBatchApplyMode(operations, options.applyMode);
    const effectiveApplyMode = applyModeDecision.mode;

    let preflight = null;
    if (options.dryRun || effectiveApplyMode === 'global-preflight') {
        preflight = await runFileBatchPreflight(runtime, operations);
        if (!preflight.success) {
            return {
                kind: /** @type {const} */ ('preflight-failed'),
                dryRun: options.dryRun,
                applyModeDecision,
                preflight,
                skippedCount: Math.max(0, operations.length - preflight.previews.length - 1),
                totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
            };
        }
    }

    if (options.dryRun) {
        return {
            kind: /** @type {const} */ ('dry-run'),
            applyModeDecision,
            preflight: /** @type {NonNullable<typeof preflight>} */ (preflight),
            totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        };
    }

    const preflightSummary = {
        ran: Boolean(preflight),
        success: preflight?.success ?? null,
        plannedCount: preflight?.previews.length ?? 0,
        durationMs: preflight?.durationMs ?? 0,
    };
    const applyStartedAt = performance.now();
    /** @type {Record<string, unknown>[]} */
    const applied = [];
    let failureIndex = -1;
    try {
        for (const [index, operation] of operations.entries()) {
            failureIndex = index;
            applied.push(await applyBatchFileOperation(runtime, operation, index));
        }
    } catch (error) {
        return {
            kind: /** @type {const} */ ('apply-failed'),
            applyModeDecision,
            preflight,
            preflightSummary,
            applied,
            failureIndex,
            skippedCount: Math.max(0, operations.length - applied.length - 1),
            partial: applied.length > 0,
            error: error instanceof Error ? error.message : String(error),
            totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
            applyMs: Math.round((performance.now() - applyStartedAt) * 1000) / 1000,
        };
    }

    return {
        kind: /** @type {const} */ ('applied'),
        applyModeDecision,
        preflight,
        preflightSummary,
        applied,
        totalMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        applyMs: Math.round((performance.now() - applyStartedAt) * 1000) / 1000,
    };
}
