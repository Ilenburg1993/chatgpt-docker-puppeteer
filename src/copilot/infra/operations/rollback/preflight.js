// @ts-check
/** Virtual-state rollback preflight performed while all affected resource locks are held. */
import path from 'node:path';
import { assertRollbackExpectedState, readRollbackPathState } from './support.js';
/** @typedef {import('./token.js').IoRollbackToken} IoRollbackToken */
/** @typedef {import('./types.js').RollbackExecutionStep} RollbackExecutionStep */

/**
 * @param {IoRollbackToken} token
 * @param {readonly string[]} paths
 * @param {Map<number,Buffer>} payloads
 * @param {boolean} dryRun
 * @returns {Promise<{ok:true;steps:RollbackExecutionStep[]}|{ok:false;steps:RollbackExecutionStep[];error:string;code:string}>}
 */
export async function preflightIoRollbackExecution(token, paths, payloads, dryRun) {
    /** @type {Map<string, import('./types.js').RollbackPathState>} */ const virtualState = new Map();
    for (const filePath of paths) virtualState.set(filePath, await readRollbackPathState(filePath));
    /** @type {RollbackExecutionStep[]} */ const steps = [];
    try {
        for (const step of token.steps) {
            if (!['write', 'delete', 'move'].includes(step.action)) {
                const error = new Error(`Ação de rollback não executável: ${step.action}`);
                /** @type {{code?:string}} */ (error).code = 'EROLLBACKACTION';
                throw error;
            }
            if (step.action === 'move') {
                const source = path.resolve(String(step.source));
                const destination = path.resolve(String(step.destination));
                const sourceState = virtualState.get(source);
                const destinationState = virtualState.get(destination);
                if (!sourceState || !destinationState || typeof step.contentHash !== 'string')
                    throw new Error(`Precondições incompletas para move no passo ${step.order}.`);
                assertRollbackExpectedState(sourceState, step.contentHash, source);
                assertRollbackExpectedState(destinationState, null, destination);
                virtualState.set(source, { exists: false, contentHash: null, bytes: null });
                virtualState.set(destination, { ...sourceState });
            } else {
                const target = path.resolve(step.target);
                const current = virtualState.get(target);
                if (!current) throw new Error(`Estado ausente para ${target}.`);
                if (step.action === 'delete') {
                    if (typeof step.contentHash !== 'string')
                        throw new Error(`Hash pós-mutação ausente para delete no passo ${step.order}.`);
                    assertRollbackExpectedState(current, step.contentHash, target);
                    virtualState.set(target, { exists: false, contentHash: null, bytes: null });
                } else {
                    assertRollbackExpectedState(current, step.contentHash ?? null, target);
                    const payload = payloads.get(step.order);
                    if (payload === undefined || typeof step.previousHash !== 'string')
                        throw new Error(`Snapshot incompleto para write no passo ${step.order}.`);
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
        return { ok: true, steps };
    } catch (error) {
        return {
            ok: false,
            steps,
            error: error instanceof Error ? error.message : String(error),
            code: String(/** @type {{code?:unknown}} */ (error)?.code ?? 'EROLLBACKPREFLIGHT'),
        };
    }
}
