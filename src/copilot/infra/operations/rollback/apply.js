// @ts-check
/** Physical rollback application after virtual preflight succeeds under held resource locks. */
import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation';
import { mkdirPathUnlocked } from '#copilot/infra/internal/filesystem/transaction';
import {
    deleteFileUnlocked,
    moveFileUnlocked,
    writeAtomicFileUnlocked,
} from '#copilot/infra/internal/filesystem/write';
import { readMutationAppliedState } from '#copilot/infra/internal/policy';
import path from 'node:path';
import { assertRollbackExpectedState, readRollbackPathState, rollbackStepPaths } from './support.js';
/** @typedef {import('./token.js').IoRollbackToken} IoRollbackToken */
/** @typedef {import('./types.js').RollbackExecutionStep} RollbackExecutionStep */

/**
 * @param {IoRollbackToken} token
 * @param {Map<number,Buffer>} payloads
 * @param {RollbackExecutionStep[]} steps
 * @param {{onPhase?: (phase:string,details:Record<string,unknown>)=>void|Promise<void>}} options
 * @returns {Promise<
 *   | {ok:true;appliedCount:number}
 *   | {ok:false;appliedCount:number;error:string;code:string;mutationApplied?:true;mutationPhase?:string|null;mutationPaths?:string[]}
 * >}
 */
export async function applyIoRollbackExecution(token, payloads, steps, options) {
    let appliedCount = 0;
    for (let index = 0; index < token.steps.length; index += 1) {
        const step = token.steps[index];
        if (!step) continue;
        try {
            if (step.action === 'write') {
                const payload = /** @type {Buffer} */ (payloads.get(step.order));
                await mkdirPathUnlocked(path.dirname(step.target), { recursive: true });
                await writeAtomicFileUnlocked(step.target, payload, {
                    ...(step.contentHash ? { expectedHash: step.contentHash } : { exclusive: true }),
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                });
                invalidateIoCoherencePath(step.target);
            } else if (step.action === 'delete') {
                const current = await readRollbackPathState(step.target);
                assertRollbackExpectedState(current, step.contentHash ?? null, step.target);
                await deleteFileUnlocked(step.target, {
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                });
                invalidateIoCoherencePath(step.target);
            } else if (step.action === 'move') {
                const source = String(step.source);
                const destination = String(step.destination);
                const current = await readRollbackPathState(source);
                assertRollbackExpectedState(current, step.contentHash ?? null, source);
                const destinationState = await readRollbackPathState(destination);
                assertRollbackExpectedState(destinationState, null, destination);
                await mkdirPathUnlocked(path.dirname(destination), { recursive: true });
                const moveResult = await moveFileUnlocked(source, destination, {
                    overwrite: false,
                    ...(current.contentHash ? { expectedSourceHash: current.contentHash } : {}),
                    ...(current.bytes === null ? {} : { expectedSourceBytes: current.bytes }),
                    ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                });
                if (moveResult.duplicatedAfterCrossDeviceMove) {
                    await deleteFileUnlocked(destination).catch(() => undefined);
                    const error = new Error('Move de rollback não removeu a origem; publicação compensada.');
                    /** @type {{code?:string}} */ (error).code = 'EROLLBACKMOVEINCOMPLETE';
                    throw error;
                }
                invalidateIoCoherencePath(source);
                invalidateIoCoherencePath(destination);
            }
            appliedCount += 1;
            const reportStep = steps[index];
            if (reportStep) reportStep.status = 'applied';
        } catch (error) {
            const mutationState = readMutationAppliedState(error);
            const reportStep = steps[index];
            if (mutationState.applied) {
                const affectedPaths = mutationState.paths.length > 0 ? mutationState.paths : rollbackStepPaths(step);
                for (const affectedPath of affectedPaths) invalidateIoCoherencePath(path.resolve(affectedPath));
                appliedCount += 1;
                if (reportStep) reportStep.status = 'applied-but-unconfirmed';
            } else if (reportStep) reportStep.status = 'failed';
            return {
                ok: false,
                appliedCount,
                error: error instanceof Error ? error.message : String(error),
                code: String(/** @type {{code?:unknown}} */ (error)?.code ?? 'EROLLBACKAPPLY'),
                ...(mutationState.applied
                    ? {
                          mutationApplied: /** @type {const} */ (true),
                          mutationPhase: mutationState.phase,
                          mutationPaths: mutationState.paths,
                      }
                    : {}),
            };
        }
    }
    return { ok: true, appliedCount };
}
