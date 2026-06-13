// @ts-check
/**
 * Primitivas de transação para mutações de I/O.
 *
 * Esta camada cria um `changeSet` rastreável que agrega operações mutáveis (write/patch/move/delete/copy) com
 * evidências suficientes para planejamento de rollback posterior.
 *
 * @module copilot/infra/runtime/transaction
 */

import { randomUUID } from 'node:crypto';
import { completeIoOperationEnvelope, createIoOperationEnvelope, failIoOperationEnvelope } from './operation.js';

/**
 * Clona payload com `structuredClone` quando disponível, mantendo fallback resiliente.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clonePayload(value) {
    const structuredCloneFn = /** @type {undefined | (<U>(input: U) => U)} */ (globalThis.structuredClone);
    if (typeof structuredCloneFn === 'function') {
        return structuredCloneFn(value);
    }

    return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/**
 * @typedef {'write' | 'patch' | 'delete' | 'copy' | 'move'} IoChangeAction
 *
 * @typedef {object} IoRollbackHint
 * @property {IoChangeAction} action
 * @property {string} target
 * @property {string | null} [previousHash]
 * @property {string | null} [contentHash]
 * @property {number | null} [bytes]
 * @property {string | null} [snapshotBase64]
 * @property {import('../io/fs/rollback-sidecar.js').IoRollbackSidecar | null} [snapshotSidecar]
 *
 * @typedef {object} IoChangeSetEntry
 * @property {string} entryId
 * @property {number} createdAtMs
 * @property {string} operationId
 * @property {IoChangeAction} action
 * @property {string[]} targets
 * @property {Record<string, unknown>} evidence
 * @property {IoRollbackHint | null} rollback
 *
 * @typedef {'open' | 'applied' | 'failed' | 'rolled-back' | 'aborted'} IoChangeSetStatus
 *
 * @typedef {object} IoChangeSet
 * @property {string} changeSetId
 * @property {number} createdAtMs
 * @property {number | null} closedAtMs
 * @property {IoChangeSetStatus} status
 * @property {ReturnType<typeof createIoOperationEnvelope>} operation
 * @property {IoChangeSetEntry[]} entries
 */

/**
 * @param {IoChangeSet} changeSet
 * @returns {void}
 */
function assertOpen(changeSet) {
    if (changeSet.status !== 'open') {
        throw new Error(`ChangeSet fechado: status=${changeSet.status}`);
    }
}

/**
 * @param {{
 *     capability: string;
 *     riskClass?: import('#copilot/core/io-contracts').IoRiskClass;
 *     targets?: readonly string[];
 *     traceId?: string | null;
 *     evidence?: Record<string, unknown>;
 * }} input
 * @returns {IoChangeSet}
 */
export function beginIoChangeSet(input) {
    return {
        changeSetId: randomUUID(),
        createdAtMs: Date.now(),
        closedAtMs: null,
        status: 'open',
        operation: createIoOperationEnvelope(input),
        entries: [],
    };
}

/**
 * @param {IoChangeSet} changeSet
 * @param {{
 *     operationId?: string;
 *     action: IoChangeAction;
 *     targets: readonly string[];
 *     evidence?: Record<string, unknown>;
 *     rollback?: IoRollbackHint | null;
 * }} entry
 * @returns {IoChangeSet}
 */
export function appendIoChangeSetEntry(changeSet, entry) {
    assertOpen(changeSet);
    const evidence = clonePayload(entry.evidence ?? {});
    const rollback = entry.rollback ? clonePayload(entry.rollback) : null;
    const nextEntry = {
        entryId: randomUUID(),
        createdAtMs: Date.now(),
        operationId: entry.operationId ?? changeSet.operation.operationId,
        action: entry.action,
        targets: [...entry.targets],
        evidence,
        rollback,
    };
    return {
        ...changeSet,
        entries: [...changeSet.entries, nextEntry],
    };
}

/**
 * @param {IoChangeSet} changeSet
 * @param {{ traceId?: string | null; evidence?: Record<string, unknown> }} [result]
 * @returns {IoChangeSet}
 */
export function applyIoChangeSet(changeSet, result = {}) {
    assertOpen(changeSet);
    const completion = {
        evidence: { entryCount: changeSet.entries.length, ...(result.evidence ?? {}) },
        ...(result.traceId === undefined ? {} : { traceId: result.traceId }),
    };
    return {
        ...changeSet,
        status: 'applied',
        closedAtMs: Date.now(),
        operation: completeIoOperationEnvelope(changeSet.operation, completion),
    };
}

/**
 * @param {IoChangeSet} changeSet
 * @param {unknown} error
 * @param {{ traceId?: string | null; evidence?: Record<string, unknown> }} [result]
 * @returns {IoChangeSet}
 */
export function failIoChangeSet(changeSet, error, result = {}) {
    assertOpen(changeSet);
    const failure = {
        evidence: { entryCount: changeSet.entries.length, ...(result.evidence ?? {}) },
        ...(result.traceId === undefined ? {} : { traceId: result.traceId }),
    };
    return {
        ...changeSet,
        status: 'failed',
        closedAtMs: Date.now(),
        operation: failIoOperationEnvelope(changeSet.operation, error, failure),
    };
}

/**
 * @param {IoChangeSet} changeSet
 * @param {{ traceId?: string | null; evidence?: Record<string, unknown> }} [result]
 * @returns {IoChangeSet}
 */
export function rollbackIoChangeSet(changeSet, result = {}) {
    if (changeSet.status === 'open') {
        throw new Error('Não é possível marcar rollback em changeSet aberto. Aplique/falhe antes.');
    }
    const currentEvidence = changeSet.operation.evidence ?? {};
    return {
        ...changeSet,
        status: 'rolled-back',
        operation: {
            ...changeSet.operation,
            traceId: result.traceId ?? changeSet.operation.traceId,
            evidence: {
                ...currentEvidence,
                rolledBack: true,
                rollbackAtMs: Date.now(),
                ...(result.evidence ?? {}),
            },
        },
    };
}

/**
 * @param {IoChangeSet} changeSet
 * @param {string} [reason]
 * @returns {IoChangeSet}
 */
export function abortIoChangeSet(changeSet, reason = 'aborted') {
    assertOpen(changeSet);
    return {
        ...changeSet,
        status: 'aborted',
        closedAtMs: Date.now(),
        operation: completeIoOperationEnvelope(changeSet.operation, {
            status: 'dry-run',
            evidence: {
                entryCount: changeSet.entries.length,
                aborted: true,
                reason,
            },
        }),
    };
}
