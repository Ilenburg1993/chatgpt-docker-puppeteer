// @ts-check
/** Parse, authorize, lock, preflight and apply signed I/O rollback tokens. */
import { acquireIoResourceLocks } from '#copilot/infra/internal/concurrency/locks';
import path from 'node:path';
import { applyIoRollbackExecution } from './apply.js';
import { preflightIoRollbackExecution } from './preflight.js';
import { loadRollbackStepPayload, rollbackStepPaths } from './support.js';
import { parseIoRollbackToken, verifyIoRollbackToken } from './token.js';
/** @typedef {import('./types.js').RollbackExecutionResult} RollbackExecutionResult */

/**
 * @param {string|import('./token.js').IoRollbackToken} tokenOrSerialized
 * @param {{dryRun?:boolean;allowedPaths?:ReadonlySet<string>;sidecarDirectory?:string;nowMs?:number;onPhase?:(phase:string,details:Record<string,unknown>)=>void|Promise<void>}} [options]
 * @returns {Promise<RollbackExecutionResult>}
 */
export async function executeIoRollbackToken(tokenOrSerialized, options = {}) {
    const token = typeof tokenOrSerialized === 'string' ? parseIoRollbackToken(tokenOrSerialized) : tokenOrSerialized;
    if (!verifyIoRollbackToken(token)) throw new Error('Rollback token inválido.');
    const dryRun = options.dryRun !== false;
    const paths = [...new Set(token.steps.flatMap(rollbackStepPaths).map((entry) => path.resolve(entry)))];
    if (options.allowedPaths) {
        for (const filePath of paths)
            if (!options.allowedPaths.has(filePath)) {
                const error = new Error(`Path fora da allowlist do rollback: ${filePath}`);
                /** @type {{code?:string}} */ (error).code = 'EROLLBACKPATHDENIED';
                throw error;
            }
    }
    /** @type {Map<number,Buffer>} */ const payloads = new Map();
    for (const step of token.steps) {
        const payload = await loadRollbackStepPayload(step, options);
        if (payload) payloads.set(step.order, payload);
    }
    const lease = await acquireIoResourceLocks(paths, {
        operation: 'rollback',
        target: token.changeSetId,
        riskClass: 'high',
        fileLock: true,
    });
    try {
        return await lease.run(async () => {
            const preflight = await preflightIoRollbackExecution(token, paths, payloads, dryRun);
            if (!preflight.ok)
                return {
                    success: false,
                    dryRun,
                    status: 'blocked',
                    tokenId: token.tokenId,
                    changeSetId: token.changeSetId,
                    appliedCount: 0,
                    steps: preflight.steps,
                    error: preflight.error,
                    code: preflight.code,
                };
            if (dryRun)
                return {
                    success: true,
                    dryRun: true,
                    status: 'ready',
                    tokenId: token.tokenId,
                    changeSetId: token.changeSetId,
                    appliedCount: 0,
                    steps: preflight.steps,
                };
            const applied = await applyIoRollbackExecution(token, payloads, preflight.steps, options);
            if (!applied.ok)
                return {
                    success: false,
                    dryRun: false,
                    status: applied.appliedCount > 0 ? 'partially-applied' : 'failed',
                    tokenId: token.tokenId,
                    changeSetId: token.changeSetId,
                    appliedCount: applied.appliedCount,
                    steps: preflight.steps,
                    error: applied.error,
                    code: applied.code,
                    ...(applied.mutationApplied
                        ? {
                              mutationApplied: /** @type {const} */ (true),
                              mutationPhase: applied.mutationPhase,
                              mutationPaths: applied.mutationPaths,
                          }
                        : {}),
                };
            return {
                success: true,
                dryRun: false,
                status: 'applied',
                tokenId: token.tokenId,
                changeSetId: token.changeSetId,
                appliedCount: applied.appliedCount,
                steps: preflight.steps,
            };
        });
    } finally {
        await lease.releaseAsync();
    }
}
