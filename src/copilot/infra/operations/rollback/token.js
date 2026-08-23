// @ts-check
/**
 * Pure rollback token planning, structure and serialization.
 *
 * Authentication is deliberately absent from this module. Runtime-owned HMAC issuance/verification lives in
 * `capability.js`; this kernel only builds deterministic claims, a content checksum and bounded serialization.
 *
 * @module copilot/infra/operations/rollback/token
 */

import { decodeBase64ToOwnedBuffer, toOwnedBuffer } from '#copilot/infra/internal/platform/buffer';
import { sha256 } from '#copilot/infra/internal/platform/hash';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {import('../contracts/index.js').IoChangeSet} IoChangeSet
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
 * @property {import('#copilot/infra/internal/operations/contracts').IoRollbackSidecar | null} snapshotSidecar
 *
 * @typedef {object} IoRollbackToken
 * @property {4} version
 * @property {'copilot.file.rollback'} audience
 * @property {string} tokenId
 * @property {string} changeSetId
 * @property {string} runtimeId
 * @property {string} workspaceId
 * @property {string} workspaceRootDigest
 * @property {number} createdAtMs
 * @property {number} expiresAtMs
 * @property {number} stepCount
 * @property {IoRollbackStep[]} steps
 * @property {string} digest
 * @property {string} authTag
 */

export const ROLLBACK_TOKEN_VERSION = 4;
export const ROLLBACK_TOKEN_AUDIENCE = /** @type {const} */ ('copilot.file.rollback');
export const MAX_ROLLBACK_TOKEN_CHARS = 32 * 1024 * 1024;
const MAX_ROLLBACK_STEPS = 1_000;

/**
 * @param {IoRollbackStep[]} steps
 * @param {string} changeSetId
 */
function buildDigest(steps, changeSetId) {
    return sha256(JSON.stringify({ changeSetId, steps }));
}

/**
 * @param {IoChangeSet} changeSet
 * @returns {IoRollbackStep[]}
 */
export function buildIoRollbackPlan(changeSet) {
    return [...changeSet.entries]
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
}

/**
 * Build the deterministic v4 envelope before the runtime-owned authentication tag is attached.
 *
 * @param {IoChangeSet} changeSet
 * @param {{runtimeId:string;workspaceId:string;workspaceRootDigest:string;createdAtMs:number;expiresAtMs:number}} claims
 * @returns {Omit<IoRollbackToken,'authTag'>}
 */
export function createIoRollbackTokenEnvelope(changeSet, claims) {
    const steps = buildIoRollbackPlan(changeSet);
    return {
        version: ROLLBACK_TOKEN_VERSION,
        audience: ROLLBACK_TOKEN_AUDIENCE,
        tokenId: randomUUID(),
        changeSetId: changeSet.changeSetId,
        runtimeId: claims.runtimeId,
        workspaceId: claims.workspaceId,
        workspaceRootDigest: claims.workspaceRootDigest,
        createdAtMs: claims.createdAtMs,
        expiresAtMs: claims.expiresAtMs,
        stepCount: steps.length,
        steps,
        digest: buildDigest(steps, changeSet.changeSetId),
    };
}

/**
 * Canonical authenticated payload. Object field order is explicit and independent from caller JSON property order.
 *
 * @param {IoRollbackToken} token
 */
export function buildIoRollbackTokenAuthPayload(token) {
    return JSON.stringify({
        version: token.version,
        audience: token.audience,
        tokenId: token.tokenId,
        changeSetId: token.changeSetId,
        runtimeId: token.runtimeId,
        workspaceId: token.workspaceId,
        workspaceRootDigest: token.workspaceRootDigest,
        createdAtMs: token.createdAtMs,
        expiresAtMs: token.expiresAtMs,
        stepCount: token.stepCount,
        steps: token.steps,
        digest: token.digest,
    });
}

/** @param {IoRollbackToken} token */
export function verifyIoRollbackTokenDigest(token) {
    return token.digest === buildDigest(token.steps, token.changeSetId);
}

/** @param {unknown} input @returns {input is IoRollbackToken} */
export function validateIoRollbackTokenShape(input) {
    const token = /** @type {Partial<IoRollbackToken>|null} */ (input && typeof input === 'object' ? input : null);
    if (!token || token.version !== ROLLBACK_TOKEN_VERSION || token.audience !== ROLLBACK_TOKEN_AUDIENCE) return false;
    if (
        typeof token.tokenId !== 'string' ||
        token.tokenId.length === 0 ||
        typeof token.changeSetId !== 'string' ||
        token.changeSetId.length === 0 ||
        typeof token.runtimeId !== 'string' ||
        token.runtimeId.length === 0 ||
        typeof token.workspaceId !== 'string' ||
        token.workspaceId.length === 0 ||
        typeof token.workspaceRootDigest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(token.workspaceRootDigest) ||
        !Number.isSafeInteger(token.createdAtMs) ||
        !Number.isSafeInteger(token.expiresAtMs) ||
        !Array.isArray(token.steps) ||
        token.steps.length > MAX_ROLLBACK_STEPS ||
        token.stepCount !== token.steps.length ||
        typeof token.digest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(token.digest) ||
        typeof token.authTag !== 'string' ||
        token.authTag.length === 0
    ) {
        return false;
    }
    for (const step of token.steps) {
        if (
            !step ||
            typeof step !== 'object' ||
            !Number.isSafeInteger(step.order) ||
            typeof step.entryId !== 'string' ||
            step.entryId.length === 0 ||
            typeof step.action !== 'string' ||
            typeof step.target !== 'string' ||
            step.target.length === 0
        ) {
            return false;
        }
    }
    return true;
}

/** @param {IoRollbackToken} token */
export function serializeIoRollbackToken(token) {
    if (!validateIoRollbackTokenShape(token)) throw new TypeError('Rollback capability token is structurally invalid.');
    return toOwnedBuffer(JSON.stringify(token)).toString('base64url');
}

/** @param {string} serialized @returns {IoRollbackToken} */
export function decodeIoRollbackToken(serialized) {
    if (typeof serialized !== 'string' || serialized.length === 0 || serialized.length > MAX_ROLLBACK_TOKEN_CHARS) {
        throw new TypeError('Rollback token ausente ou acima do limite permitido.');
    }
    const raw = decodeBase64ToOwnedBuffer(serialized, 'rollback token').toString('utf8');
    const token = /** @type {unknown} */ (JSON.parse(raw));
    if (!validateIoRollbackTokenShape(token)) {
        throw new Error('Rollback capability token inválido ou versão incompatível.');
    }
    return token;
}
