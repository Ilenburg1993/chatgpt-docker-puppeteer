// @ts-check
/**
 * Primitivas de transação para mutações de I/O.
 *
 * Esta camada cria um `changeSet` rastreável que agrega operações mutáveis (write/patch/move/delete/copy) com
 * evidências suficientes para planejamento de rollback posterior.
 *
 * @module copilot/infra/operations/transaction
 */

import { randomUUID } from 'node:crypto';
import { completeIoOperationEnvelope, createIoOperationEnvelope, failIoOperationEnvelope } from './operation.js';

/** @typedef {import('./contracts/index.js').IoChangeAction} IoChangeAction */
/** @typedef {import('./contracts/index.js').IoRollbackHint} IoRollbackHint */
/** @typedef {import('./contracts/index.js').IoChangeSet} IoChangeSet */

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
 *     riskClass?: import('#copilot/infra/internal/operations/contracts').IoRiskClass;
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
    const evidence = structuredClone(entry.evidence ?? {});
    const rollback = entry.rollback ? structuredClone(entry.rollback) : null;
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
