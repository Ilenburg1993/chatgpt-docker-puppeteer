// @ts-check
/**
 * Planejamento e serialização de rollback para change sets de I/O.
 *
 * @module copilot/infra/runtime/rollback
 */

import { randomUUID } from 'node:crypto';
import { decodeBase64ToOwnedBuffer, toOwnedBuffer } from '../shared/buffer.js';
import { sha256 } from '../shared/hash.js';

/**
 * @typedef {import('./transaction.js').IoChangeSet} IoChangeSet
 *
 * @typedef {import('./transaction.js').IoRollbackHint} IoRollbackHint
 *
 * @typedef {object} IoRollbackStep
 * @property {number} order
 * @property {string} entryId
 * @property {IoRollbackHint['action']} action
 * @property {string} target
 * @property {string | null} previousHash
 * @property {string | null} contentHash
 * @property {number | null} bytes
 * @property {string | null} snapshotBase64
 * @property {import('../io/fs/rollback-sidecar.js').IoRollbackSidecar | null} snapshotSidecar
 *
 * @typedef {object} IoRollbackToken
 * @property {number} version
 * @property {string} tokenId
 * @property {string} changeSetId
 * @property {number} createdAtMs
 * @property {number} stepCount
 * @property {IoRollbackStep[]} steps
 * @property {string} digest
 */

const ROLLBACK_TOKEN_VERSION = 2;
const SUPPORTED_ROLLBACK_TOKEN_VERSIONS = new Set([1, ROLLBACK_TOKEN_VERSION]);

/**
 * @param {IoRollbackStep[]} steps
 * @param {string} changeSetId
 * @returns {string}
 */
function buildDigest(steps, changeSetId) {
    return sha256(JSON.stringify({ changeSetId, steps }));
}

/**
 * @param {IoChangeSet} changeSet
 * @returns {IoRollbackStep[]}
 */
export function buildIoRollbackPlan(changeSet) {
    const rollbackEntries = [...changeSet.entries]
        .reverse()
        .filter((entry) => entry.rollback !== null)
        .map((entry, index) => {
            const rollback = /** @type {IoRollbackHint} */ (entry.rollback);
            return {
                order: index + 1,
                entryId: entry.entryId,
                action: rollback.action,
                target: rollback.target,
                previousHash: rollback.previousHash ?? null,
                contentHash: rollback.contentHash ?? null,
                bytes: rollback.bytes ?? null,
                snapshotBase64: rollback.snapshotBase64 ?? null,
                snapshotSidecar: rollback.snapshotSidecar ?? null,
            };
        });
    return rollbackEntries;
}

/**
 * @param {IoChangeSet} changeSet
 * @returns {IoRollbackToken}
 */
export function createIoRollbackToken(changeSet) {
    const steps = buildIoRollbackPlan(changeSet);
    return {
        version: ROLLBACK_TOKEN_VERSION,
        tokenId: randomUUID(),
        changeSetId: changeSet.changeSetId,
        createdAtMs: Date.now(),
        stepCount: steps.length,
        steps,
        digest: buildDigest(steps, changeSet.changeSetId),
    };
}

/**
 * @param {IoRollbackToken} token
 * @returns {boolean}
 */
export function verifyIoRollbackToken(token) {
    if (!SUPPORTED_ROLLBACK_TOKEN_VERSIONS.has(token.version)) return false;
    const expected = buildDigest(token.steps, token.changeSetId);
    return expected === token.digest;
}

/**
 * @param {IoRollbackToken} token
 * @returns {string}
 */
export function serializeIoRollbackToken(token) {
    return toOwnedBuffer(JSON.stringify(token)).toString('base64url');
}

/**
 * @param {string} serialized
 * @returns {IoRollbackToken}
 */
export function parseIoRollbackToken(serialized) {
    const raw = decodeBase64ToOwnedBuffer(serialized, 'rollback token').toString('utf8');
    const token = /** @type {IoRollbackToken} */ (JSON.parse(raw));
    if (!verifyIoRollbackToken(token)) {
        throw new Error('Rollback token inválido: digest mismatch ou versão incompatível.');
    }
    return token;
}
