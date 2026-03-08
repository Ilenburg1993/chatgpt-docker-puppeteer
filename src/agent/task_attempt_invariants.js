// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { releaseTaskLock } from '#infra/db/task_repo';

/**
 * @param {string} taskId
 * @returns {string | null}
 */
function getCurrentAttemptIdForTask(taskId) {
    if (!taskId) return null;
    try {
        const db = getDb();
        const row = /** @type {any} */ (
            db.prepare('SELECT latest_attempt_id, last_correlation_id FROM tasks WHERE id = ?').get(taskId)
        );
        return row?.latest_attempt_id ?? row?.last_correlation_id ?? null;
    } catch (/** @type {any} */ _) {
        return null;
    }
}

/**
 * @typedef {object} EvaluateAttemptInvariantsParams
 * @property {string} taskId
 * @property {string | null} attemptId
 */
/**
 * @typedef {object} EvaluateAttemptInvariantsOptions
 * @property {any} [taskId]
 * @property {any} [attemptId]
 */
/**
 * @param {EvaluateAttemptInvariantsParams} params
 * @returns {{ apply: boolean; currentAttemptId: string | null; reason: string }}
 */
function evaluateAttemptInvariants({ taskId, attemptId = null }) {
    if (!attemptId) {
        return { apply: true, currentAttemptId: getCurrentAttemptIdForTask(taskId), reason: 'NO_ATTEMPT_ID' };
    }

    const currentAttemptId = getCurrentAttemptIdForTask(taskId);
    if (!currentAttemptId) {
        return { apply: true, currentAttemptId: null, reason: 'NO_CURRENT_ATTEMPT' };
    }

    if (String(currentAttemptId) !== String(attemptId)) {
        return { apply: false, currentAttemptId: String(currentAttemptId), reason: 'STALE_ATTEMPT' };
    }

    return { apply: true, currentAttemptId: String(currentAttemptId), reason: 'MATCHED_ATTEMPT' };
}

/**
 * @typedef {object} EmitStaleAttemptIgnoredEventParams
 * @property {string} taskId
 * @property {string | null} attemptId
 * @property {string | null} currentAttemptId
 * @property {string | null} actionCode
 * @property {string | null} correlationId
 * @property {string | null} msgId
 * @property {string} context
 */
/**
 * @typedef {object} EmitStaleAttemptIgnoredEventOptions
 * @property {any} [taskId]
 * @property {any} [attemptId]
 * @property {any} [currentAttemptId]
 * @property {any} [actionCode]
 * @property {any} [correlationId]
 * @property {any} [msgId]
 * @property {any} [context]
 */
/**
 * @param {EmitStaleAttemptIgnoredEventParams} params
 * @returns {any}
 */
function emitStaleAttemptIgnoredEvent({
    taskId,
    attemptId = null,
    currentAttemptId = null,
    actionCode = null,
    correlationId = null,
    msgId = null,
    context = 'stale_attempt',
}) {
    if (!taskId || !attemptId) {
        return false;
    }

    return recordEvent({
        entityType: 'task',
        entityId: taskId,
        tsMs: Date.now(),
        actorType: 'system',
        eventType: 'TASK_EVENT_STALE_ATTEMPT_IGNORED',
        payload: {
            attempt_id: attemptId,
            current_attempt_id: currentAttemptId,
            action_code: actionCode || null,
            correlation_id: correlationId || null,
            msg_id: msgId || null,
            context,
        },
        dedupKey: `task:${taskId}:stale_attempt:${attemptId}:${actionCode || 'unknown'}:${msgId || correlationId || Date.now()}`,
    });
}

/**
 * @typedef {object} ReleaseTaskLockForAttemptParams
 * @property {string} taskId
 * @property {string | null} attemptId
 * @property {string | null} [workerId]
 * @property {string | null} actionCode
 * @property {string | null} correlationId
 * @property {string} context
 */
/**
 * @typedef {object} ReleaseTaskLockForAttemptOptions
 * @property {any} [taskId]
 * @property {any} [attemptId]
 * @property {any} [workerId]
 * @property {any} [actionCode]
 * @property {any} [correlationId]
 * @property {any} [context]
 */
/**
 * @param {ReleaseTaskLockForAttemptParams} params
 * @returns {number}
 */
function releaseTaskLockForAttempt({
    taskId,
    attemptId = null,
    workerId = null,
    actionCode = null,
    correlationId = null,
    context = 'lock_release',
}) {
    const changes = releaseTaskLock({
        taskId,
        workerId: workerId || undefined,
        expectedAttemptId: attemptId || undefined,
    });

    if (attemptId && changes === 0) {
        const currentAttemptId = getCurrentAttemptIdForTask(taskId);
        recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: Date.now(),
            actorType: 'system',
            eventType: 'TASK_LOCK_RELEASE_SKIPPED_STALE_ATTEMPT',
            payload: {
                attempt_id: attemptId,
                current_attempt_id: currentAttemptId,
                action_code: actionCode || null,
                correlation_id: correlationId || null,
                context,
            },
            dedupKey: `task:${taskId}:lock_release_skipped:${attemptId}:${actionCode || 'unknown'}:${context}`,
        });
    }

    return changes;
}

export {
    emitStaleAttemptIgnoredEvent,
    evaluateAttemptInvariants,
    getCurrentAttemptIdForTask,
    releaseTaskLockForAttempt,
};
