// @ts-check
/**
 * Preflight e aplicação de tokens de rollback de I/O.
 *
 * @module copilot/infra/runtime/rollback-executor
 */

import path from 'node:path';
import { acquireIoResourceLocks } from '../io-locks.js';
import { mkdirPathUnlocked } from '../io/fs/mkdir.js';
import { moveFileUnlocked } from '../io/fs/move.js';
import { readMutationAppliedState } from '../io/fs/mutation-state.js';
import { deleteFileUnlocked } from '../io/fs/remove.js';
import { readVerifiedRollbackSidecar } from '../io/fs/rollback-sidecar.js';
import { readBinaryMutationSnapshot } from '../io/fs/snapshot.js';
import { writeAtomicFileUnlocked } from '../io/fs/write-atomic.js';
import { invalidateIoCacheTiers } from '../io/invalidation/cache-tiers.js';
import { decodeBase64ToOwnedBuffer } from '../shared/buffer.js';
import { sha256 } from '../shared/hash.js';
import { parseIoRollbackToken, verifyIoRollbackToken } from './rollback.js';

/**
 * @typedef {{ exists: boolean; contentHash: string | null; bytes: number | null }} RollbackPathState
 *
 * @typedef {import('./rollback.js').IoRollbackStep} IoRollbackStep
 */

/**
 * @param {string} filePath
 * @returns {Promise<RollbackPathState>}
 */
async function readPathState(filePath) {
    try {
        const snapshot = await readBinaryMutationSnapshot(filePath, { snapshotMaxBytes: 0 });
        return { exists: true, contentHash: snapshot.contentHash, bytes: snapshot.bytesRead };
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return { exists: false, contentHash: null, bytes: null };
        }
        throw error;
    }
}

/**
 * @param {RollbackPathState} state
 * @param {string | null} expectedHash
 * @param {string} label
 */
function assertExpectedState(state, expectedHash, label) {
    if (expectedHash === null) {
        if (state.exists) {
            const error = new Error(`${label} deveria estar ausente antes do rollback.`);
            /** @type {{ code?: string }} */ (error).code = 'EROLLBACKEXPECTEDABSENT';
            throw error;
        }
        return;
    }
    if (!state.exists || state.contentHash !== expectedHash) {
        const error = new Error(`${label} divergiu da precondição do rollback.`);
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKEXPECTEDHASH';
        throw error;
    }
}

/**
 * @param {IoRollbackStep} step
 * @param {{ sidecarDirectory?: string; nowMs?: number }} options
 * @returns {Promise<Buffer | null>}
 */
async function loadStepPayload(step, options) {
    if (step.action !== 'write') return null;
    let payload = null;
    if (typeof step.snapshotBase64 === 'string') {
        payload = decodeBase64ToOwnedBuffer(step.snapshotBase64, 'rollback snapshot');
    } else if (step.snapshotSidecar) {
        payload = await readVerifiedRollbackSidecar(step.snapshotSidecar, {
            ...(options.sidecarDirectory ? { directory: options.sidecarDirectory } : {}),
            ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
        });
    }
    if (payload === null || typeof step.previousHash !== 'string' || sha256(payload) !== step.previousHash) {
        const error = new Error(`Snapshot ausente ou inválido para o passo ${step.order}.`);
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSNAPSHOT';
        throw error;
    }
    if (step.bytes !== null && step.bytes !== payload.byteLength) {
        const error = new Error(`Tamanho do snapshot diverge no passo ${step.order}.`);
        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKSNAPSHOTSIZE';
        throw error;
    }
    return payload;
}

/**
 * @param {IoRollbackStep} step
 * @returns {string[]}
 */
function stepPaths(step) {
    if (step.action === 'move') {
        if (!step.source || !step.destination) {
            const error = new Error(`Passo move ${step.order} não possui source/destination executáveis.`);
            /** @type {{ code?: string }} */ (error).code = 'EROLLBACKLEGACYMOVE';
            throw error;
        }
        return [step.source, step.destination];
    }
    return [step.target];
}

/** @typedef {'ready' | 'pending' | 'applied' | 'failed' | 'applied-but-unconfirmed'} RollbackExecutionStepStatus */
/**
 * @typedef {{
 *     order: number;
 *     action: import('./transaction.js').IoChangeAction;
 *     target: string;
 *     status: RollbackExecutionStepStatus;
 * }} RollbackExecutionStep
 */
/**
 * @typedef {{
 *     success: true;
 *     dryRun: boolean;
 *     status: 'ready' | 'applied';
 *     tokenId: string;
 *     changeSetId: string;
 *     appliedCount: number;
 *     steps: RollbackExecutionStep[];
 * }} RollbackExecutionSuccess
 */
/**
 * @typedef {{
 *     success: false;
 *     dryRun: boolean;
 *     status: 'blocked' | 'failed' | 'partially-applied';
 *     tokenId: string;
 *     changeSetId: string;
 *     appliedCount: number;
 *     steps: RollbackExecutionStep[];
 *     error: string;
 *     code: string;
 *     mutationApplied?: true;
 *     mutationPhase?: string | null;
 *     mutationPaths?: string[];
 * }} RollbackExecutionFailure
 */
/** @typedef {RollbackExecutionSuccess | RollbackExecutionFailure} RollbackExecutionResult */

/**
 * @param {string | import('./rollback.js').IoRollbackToken} tokenOrSerialized
 * @param {{
 *     dryRun?: boolean;
 *     allowedPaths?: ReadonlySet<string>;
 *     sidecarDirectory?: string;
 *     nowMs?: number;
 *     onPhase?: (phase: string, details: Record<string, unknown>) => void | Promise<void>;
 * }} [options]
 * @returns {Promise<RollbackExecutionResult>}
 */
export async function executeIoRollbackToken(tokenOrSerialized, options = {}) {
    const token = typeof tokenOrSerialized === 'string' ? parseIoRollbackToken(tokenOrSerialized) : tokenOrSerialized;
    if (!verifyIoRollbackToken(token)) {
        throw new Error('Rollback token inválido.');
    }
    const dryRun = options.dryRun !== false;
    const paths = [...new Set(token.steps.flatMap(stepPaths).map((entry) => path.resolve(entry)))];
    if (options.allowedPaths) {
        for (const filePath of paths) {
            if (!options.allowedPaths.has(filePath)) {
                const error = new Error(`Path fora da allowlist do rollback: ${filePath}`);
                /** @type {{ code?: string }} */ (error).code = 'EROLLBACKPATHDENIED';
                throw error;
            }
        }
    }

    const payloads = new Map();
    for (const step of token.steps) {
        const payload = await loadStepPayload(step, options);
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
            /** @type {Map<string, RollbackPathState>} */
            const virtualState = new Map();
            for (const filePath of paths) {
                virtualState.set(filePath, await readPathState(filePath));
            }

            /** @type {RollbackExecutionStep[]} */
            const steps = [];
            try {
                for (const step of token.steps) {
                    if (!['write', 'delete', 'move'].includes(step.action)) {
                        const error = new Error(`Ação de rollback não executável: ${step.action}`);
                        /** @type {{ code?: string }} */ (error).code = 'EROLLBACKACTION';
                        throw error;
                    }
                    if (step.action === 'move') {
                        const source = path.resolve(String(step.source));
                        const destination = path.resolve(String(step.destination));
                        const sourceState = virtualState.get(source);
                        const destinationState = virtualState.get(destination);
                        if (!sourceState || !destinationState || typeof step.contentHash !== 'string') {
                            throw new Error(`Precondições incompletas para move no passo ${step.order}.`);
                        }
                        assertExpectedState(sourceState, step.contentHash, source);
                        assertExpectedState(destinationState, null, destination);
                        virtualState.set(source, { exists: false, contentHash: null, bytes: null });
                        virtualState.set(destination, { ...sourceState });
                    } else {
                        const target = path.resolve(step.target);
                        const current = virtualState.get(target);
                        if (!current) throw new Error(`Estado ausente para ${target}.`);
                        if (step.action === 'delete') {
                            if (typeof step.contentHash !== 'string') {
                                throw new Error(`Hash pós-mutação ausente para delete no passo ${step.order}.`);
                            }
                            assertExpectedState(current, step.contentHash, target);
                            virtualState.set(target, { exists: false, contentHash: null, bytes: null });
                        } else {
                            assertExpectedState(current, step.contentHash ?? null, target);
                            const payload = payloads.get(step.order);
                            if (payload === undefined || typeof step.previousHash !== 'string') {
                                throw new Error(`Snapshot incompleto para write no passo ${step.order}.`);
                            }
                            virtualState.set(target, {
                                exists: true,
                                contentHash: step.previousHash,
                                bytes: payload.byteLength,
                            });
                        }
                    }
                    steps.push({
                        order: step.order,
                        action: step.action,
                        target: step.target,
                        status: dryRun ? 'ready' : 'pending',
                    });
                }
            } catch (error) {
                return {
                    success: false,
                    dryRun,
                    status: 'blocked',
                    tokenId: token.tokenId,
                    changeSetId: token.changeSetId,
                    appliedCount: 0,
                    steps,
                    error: error instanceof Error ? error.message : String(error),
                    code: String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'EROLLBACKPREFLIGHT'),
                };
            }

            if (dryRun) {
                return {
                    success: true,
                    dryRun: true,
                    status: 'ready',
                    tokenId: token.tokenId,
                    changeSetId: token.changeSetId,
                    appliedCount: 0,
                    steps,
                };
            }

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
                        invalidateIoCacheTiers(step.target);
                    } else if (step.action === 'delete') {
                        const current = await readPathState(step.target);
                        assertExpectedState(current, step.contentHash ?? null, step.target);
                        await deleteFileUnlocked(step.target, {
                            ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
                        });
                        invalidateIoCacheTiers(step.target);
                    } else if (step.action === 'move') {
                        const source = String(step.source);
                        const destination = String(step.destination);
                        const current = await readPathState(source);
                        assertExpectedState(current, step.contentHash ?? null, source);
                        const destinationState = await readPathState(destination);
                        assertExpectedState(destinationState, null, destination);
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
                            /** @type {{ code?: string }} */ (error).code = 'EROLLBACKMOVEINCOMPLETE';
                            throw error;
                        }
                        invalidateIoCacheTiers(source);
                        invalidateIoCacheTiers(destination);
                    }
                    appliedCount += 1;
                    const reportStep = steps[index];
                    if (reportStep) reportStep.status = 'applied';
                } catch (error) {
                    const mutationState = readMutationAppliedState(error);
                    const reportStep = steps[index];
                    if (mutationState.applied) {
                        const affectedPaths = mutationState.paths.length > 0 ? mutationState.paths : stepPaths(step);
                        for (const affectedPath of affectedPaths) invalidateIoCacheTiers(path.resolve(affectedPath));
                        appliedCount += 1;
                        if (reportStep) reportStep.status = 'applied-but-unconfirmed';
                    } else if (reportStep) {
                        reportStep.status = 'failed';
                    }
                    return {
                        success: false,
                        dryRun: false,
                        status: appliedCount > 0 ? 'partially-applied' : 'failed',
                        tokenId: token.tokenId,
                        changeSetId: token.changeSetId,
                        appliedCount,
                        steps,
                        error: error instanceof Error ? error.message : String(error),
                        code: String(/** @type {{ code?: unknown }} */ (error)?.code ?? 'EROLLBACKAPPLY'),
                        ...(mutationState.applied
                            ? {
                                  mutationApplied: true,
                                  mutationPhase: mutationState.phase,
                                  mutationPaths: mutationState.paths,
                              }
                            : {}),
                    };
                }
            }

            return {
                success: true,
                dryRun: false,
                status: 'applied',
                tokenId: token.tokenId,
                changeSetId: token.changeSetId,
                appliedCount,
                steps,
            };
        });
    } finally {
        await lease.releaseAsync();
    }
}
