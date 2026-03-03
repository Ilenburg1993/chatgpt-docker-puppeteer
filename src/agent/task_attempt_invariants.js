// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { releaseTaskLock } from '#infra/db/task_repo';

/**
 * @param {string} taskId
 * @returns {string|null}
 */
function getCurrentAttemptIdForTask(taskId) {
    if (!taskId) return null;
    try {
        const db = getDb();
        const row = db.prepare('SELECT latest_attempt_id, last_correlation_id FROM tasks WHERE id = ?').get(taskId);
        return row?.latest_attempt_id ?? row?.last_correlation_id ?? null;
    } catch (_) {
        return null;
    }
}

/**
 * @param {{ taskId: string, attemptId?: string|null }} params
 * @returns {{ apply: boolean, currentAttemptId: string|null, reason: string }}
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
 * @param {{
 *   taskId: string,
 *   attemptId?: string|null,
 *   currentAttemptId?: string|null,
 *   actionCode?: string|null,
 *   correlationId?: string|null,
 *   msgId?: string|null,
 *   context?: string
 * }} params
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
 * @param {{
 *   taskId: string,
 *   attemptId?: string|null,
 *   workerId?: string|null,
 *   actionCode?: string|null,
 *   correlationId?: string|null,
 *   context?: string
 * }} params
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
