// @ts-check
/**
 * Planejamento e serialização de rollback para change sets de I/O.
 *
 * @module copilot/infra/operations/rollback/token
 */

import { decodeBase64ToOwnedBuffer, sha256, toOwnedBuffer } from '#copilot/infra/internal/platform';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {import('../contracts/index.js').IoChangeSet} IoChangeSet
 *
 * @typedef {import('../contracts/index.js').IoRollbackHint} IoRollbackHint
 *
 * @typedef {object} IoRollbackStep
 * @property {number} order
 * @property {string} entryId
 * @property {IoRollbackHint['action']} action
 * @property {string} target
 * @property {string | null} [source]
 * @property {string | null} [destination]
 * @property {string | null} previousHash
 * @property {string | null} contentHash
 * @property {number | null} bytes
 * @property {string | null} snapshotBase64
 * @property {import('#copilot/infra/internal/filesystem/transaction').IoRollbackSidecar | null} snapshotSidecar
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

const ROLLBACK_TOKEN_VERSION = 3;
const SUPPORTED_ROLLBACK_TOKEN_VERSIONS = new Set([1, 2, ROLLBACK_TOKEN_VERSION]);
const MAX_ROLLBACK_TOKEN_CHARS = 32 * 1024 * 1024;
const MAX_ROLLBACK_STEPS = 1_000;

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
                source: rollback.source ?? null,
                destination: rollback.destination ?? null,
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
    if (!token || typeof token !== 'object') return false;
    if (!SUPPORTED_ROLLBACK_TOKEN_VERSIONS.has(token.version)) return false;
    if (
        typeof token.tokenId !== 'string' ||
        typeof token.changeSetId !== 'string' ||
        !Number.isSafeInteger(token.createdAtMs) ||
        !Array.isArray(token.steps) ||
        token.steps.length > MAX_ROLLBACK_STEPS ||
        token.stepCount !== token.steps.length ||
        typeof token.digest !== 'string'
    ) {
        return false;
    }
    for (const step of token.steps) {
        if (
            !step ||
            typeof step !== 'object' ||
            !Number.isSafeInteger(step.order) ||
            typeof step.entryId !== 'string' ||
            typeof step.action !== 'string' ||
            typeof step.target !== 'string' ||
            step.target.length === 0
        ) {
            return false;
        }
    }
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
    if (typeof serialized !== 'string' || serialized.length === 0 || serialized.length > MAX_ROLLBACK_TOKEN_CHARS) {
        throw new TypeError('Rollback token ausente ou acima do limite permitido.');
    }
    const raw = decodeBase64ToOwnedBuffer(serialized, 'rollback token').toString('utf8');
    const token = /** @type {IoRollbackToken} */ (JSON.parse(raw));
    if (!verifyIoRollbackToken(token)) {
        throw new Error('Rollback token inválido: digest mismatch ou versão incompatível.');
    }
    return token;
}
