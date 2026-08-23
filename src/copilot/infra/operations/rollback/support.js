// @ts-check
/** Snapshot loading, path expansion and exact state preconditions for rollback execution. */
import {
    readBinaryMutationSnapshot,
    readVerifiedRollbackSidecar,
} from '#copilot/infra/internal/filesystem/transaction';
import { decodeBase64ToOwnedBuffer } from '#copilot/infra/internal/platform/buffer';
import { sha256 } from '#copilot/infra/internal/platform/hash';
/** @typedef {import('./token.js').IoRollbackStep} IoRollbackStep */
/** @typedef {import('./types.js').RollbackPathState} RollbackPathState */

/** @param {string} filePath @returns {Promise<RollbackPathState>} */
export async function readRollbackPathState(filePath) {
    try {
        const snapshot = await readBinaryMutationSnapshot(filePath, { snapshotMaxBytes: 0 });
        return { exists: true, contentHash: snapshot.contentHash, bytes: snapshot.bytesRead };
    } catch (error) {
        const code = /** @type {{code?:unknown}} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, contentHash: null, bytes: null };
        throw error;
    }
}
/** @param {RollbackPathState} state @param {string|null} expectedHash @param {string} label */
export function assertRollbackExpectedState(state, expectedHash, label) {
    if (expectedHash === null) {
        if (state.exists) {
            const error = new Error(`${label} deveria estar ausente antes do rollback.`);
            /** @type {{code?:string}} */ (error).code = 'EROLLBACKEXPECTEDABSENT';
            throw error;
        }
        return;
    }
    if (!state.exists || state.contentHash !== expectedHash) {
        const error = new Error(`${label} divergiu da precondição do rollback.`);
        /** @type {{code?:string}} */ (error).code = 'EROLLBACKEXPECTEDHASH';
        throw error;
    }
}
/** @param {IoRollbackStep} step @param {{sidecarDirectory?:string;nowMs?:number}} options */
export async function loadRollbackStepPayload(step, options) {
    if (step.action !== 'write') return null;
    let payload = null;
    if (typeof step.snapshotBase64 === 'string')
        payload = decodeBase64ToOwnedBuffer(step.snapshotBase64, 'rollback snapshot');
    else if (step.snapshotSidecar)
        payload = await readVerifiedRollbackSidecar(step.snapshotSidecar, {
            ...(options.sidecarDirectory ? { directory: options.sidecarDirectory } : {}),
            ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
        });
    if (payload === null || typeof step.previousHash !== 'string' || sha256(payload) !== step.previousHash) {
        const error = new Error(`Snapshot ausente ou inválido para o passo ${step.order}.`);
        /** @type {{code?:string}} */ (error).code = 'EROLLBACKSNAPSHOT';
        throw error;
    }
    if (step.bytes !== null && step.bytes !== payload.byteLength) {
        const error = new Error(`Tamanho do snapshot diverge no passo ${step.order}.`);
        /** @type {{code?:string}} */ (error).code = 'EROLLBACKSNAPSHOTSIZE';
        throw error;
    }
    return payload;
}
/** @param {IoRollbackStep} step */
export function rollbackStepPaths(step) {
    if (step.action === 'move') {
        if (!step.source || !step.destination) {
            const error = new Error(`Passo move ${step.order} não possui source/destination executáveis.`);
            /** @type {{code?:string}} */ (error).code = 'EROLLBACKLEGACYMOVE';
            throw error;
        }
        return [step.source, step.destination];
    }
    return [step.target];
}
