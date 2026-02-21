// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { getMissionById, MISSION_STATUS, updateMission } from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';

const TERMINAL_STATUSES = new Set([MISSION_STATUS.DONE, MISSION_STATUS.FAILED, MISSION_STATUS.CANCELLED]);

/**
 * @typedef {{
 *  ok: boolean,
 *  mission?: any,
 *  statusCode?: number,
 *  code?: string,
 *  error?: string,
 *  details?: any,
 * }} MissionTransitionResult
 */

function _asMissionId(missionId) {
    return String(missionId || '').trim();
}

function _ensureMission(missionId) {
    const id = _asMissionId(missionId);
    if (!id) {
        return { ok: false, statusCode: 400, code: 'MISSION_ID_INVALID', error: 'mission_id inválido' };
    }
    const mission = getMissionById(id);
    if (!mission) {
        return { ok: false, statusCode: 404, code: 'MISSION_NOT_FOUND', error: 'Missão não encontrada' };
    }
    return { ok: true, mission, missionId: id };
}

function _transitionConflict({ mission, toStatus, allowedFrom }) {
    const from = String(mission?.status || '').toUpperCase();
    const to = String(toStatus || '').toUpperCase();
    const allowed = new Set((Array.isArray(allowedFrom) ? allowedFrom : []).map(v => String(v).toUpperCase()));

    if (from === to) {
        return {
            ok: false,
            statusCode: 409,
            code: 'MISSION_TRANSITION_NOOP',
            error: `Missão já está em ${to}`,
            details: { from, to },
        };
    }

    if (!allowed.has(from)) {
        return {
            ok: false,
            statusCode: 409,
            code: 'MISSION_TRANSITION_INVALID',
            error: `Transição inválida de ${from} para ${to}`,
            details: { from, to, allowed_from: Array.from(allowed) },
        };
    }

    return null;
}

function _mergeMissionContext(baseContext, patchContext, { failureReason = null } = {}) {
    const context = baseContext && typeof baseContext === 'object' ? baseContext : {};
    const patch = patchContext && typeof patchContext === 'object' ? patchContext : {};
    return {
        ...context,
        ...patch,
        ...(failureReason ? { failure_reason: String(failureReason) } : {}),
    };
}

function _recordMissionEvent({
    missionId,
    eventType,
    actorType = 'system',
    actorId = null,
    payload = {},
    dedupKey = null,
}) {
    try {
        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType,
            actorId,
            eventType,
            payload,
            dedupKey,
        });
    } catch (err) {
        log('WARN', `[MissionExecutionService] Falha ao registrar evento ${eventType}: ${err?.message || String(err)}`);
    }
}

function _verifyProgressPreconditions(mission, expected = {}) {
    const progress = mission?.context?.progress || {};
    if (expected.currentTaskId !== undefined && progress.current_task_id !== expected.currentTaskId) {
        return {
            ok: false,
            statusCode: 423,
            code: 'MISSION_LOCKED',
            error: 'current_task_id divergente durante atualização de missão',
            details: {
                expected_current_task_id: expected.currentTaskId,
                actual_current_task_id: progress.current_task_id || null,
            },
        };
    }
    if (
        expected.currentStepIndex !== undefined &&
        Number(progress.current_step_index || 0) !== Number(expected.currentStepIndex || 0)
    ) {
        return {
            ok: false,
            statusCode: 409,
            code: 'MISSION_PROGRESS_STALE',
            error: 'current_step_index divergente durante atualização de missão',
            details: {
                expected_current_step_index: Number(expected.currentStepIndex || 0),
                actual_current_step_index: Number(progress.current_step_index || 0),
            },
        };
    }
    return null;
}

function _applyTaskMutation(taskMutation, nowMs) {
    if (typeof taskMutation !== 'function') {
        return;
    }
    const db = getDb();
    taskMutation(db, nowMs);
}

/**
 * @param {{
 *  missionId: string,
 *  toStatus: string,
 *  allowedFrom: string[],
 *  startedAtMs?: number|null,
 *  completedAtMs?: number|null,
 *  contextPatch?: Record<string, any>|null,
 *  failureReason?: string|null,
 *  expectedProgress?: { currentTaskId?: string|null, currentStepIndex?: number }|null,
 *  actorType?: string,
 *  actorId?: string|null,
 *  eventType?: string,
 *  dedupKey?: string|null,
 *  payload?: Record<string, any>,
 *  taskMutation?: ((db: any, nowMs: number) => void)|null,
 * }} params
 * @returns {MissionTransitionResult}
 */
function transitionMission(params) {
    const now = Date.now();
    const missionRef = _ensureMission(params.missionId);
    if (!missionRef.ok) return missionRef;

    const { mission, missionId } = missionRef;
    const conflict = _transitionConflict({
        mission,
        toStatus: params.toStatus,
        allowedFrom: params.allowedFrom,
    });
    if (conflict) return conflict;

    const preconditionFailure = _verifyProgressPreconditions(mission, params.expectedProgress || {});
    if (preconditionFailure) {
        _recordMissionEvent({
            missionId,
            eventType: 'MISSION_TRANSITION_REJECTED',
            actorType: params.actorType || 'system',
            actorId: params.actorId || null,
            payload: {
                reason: preconditionFailure.code,
                ...preconditionFailure.details,
            },
            dedupKey: params.dedupKey ? `${params.dedupKey}:rejected` : null,
        });
        return preconditionFailure;
    }

    const mergedContext = _mergeMissionContext(mission.context, params.contextPatch, {
        failureReason: params.failureReason || null,
    });

    let updated;
    try {
        updated = updateMission(missionId, {
            status: params.toStatus,
            context: mergedContext,
            ...(params.startedAtMs !== undefined ? { started_at_ms: params.startedAtMs } : {}),
            ...(params.completedAtMs !== undefined ? { completed_at_ms: params.completedAtMs } : {}),
        });
        _applyTaskMutation(params.taskMutation, now);
    } catch (err) {
        return {
            ok: false,
            statusCode: 500,
            code: 'MISSION_TRANSITION_FAILED',
            error: 'Falha ao aplicar transição da missão',
            details: err?.message || String(err),
        };
    }

    _recordMissionEvent({
        missionId,
        eventType: params.eventType || 'MISSION_STATUS_CHANGED',
        actorType: params.actorType || 'system',
        actorId: params.actorId || null,
        payload: {
            from: mission.status,
            to: params.toStatus,
            ...(params.payload || {}),
        },
        dedupKey: params.dedupKey || null,
    });

    return { ok: true, mission: updated };
}

/**
 * Atualiza progresso/contexto da missão em caminho único de domínio.
 *
 * @param {{
 *  missionId: string,
 *  progress: Record<string, any>,
 *  contextPatch?: Record<string, any>|null,
 *  expectedProgress?: { currentTaskId?: string|null, currentStepIndex?: number }|null,
 *  actorType?: string,
 *  actorId?: string|null,
 *  eventType?: string,
 *  dedupKey?: string|null,
 *  payload?: Record<string, any>,
 * }} params
 * @returns {MissionTransitionResult}
 */
function updateMissionProgressState(params) {
    const missionRef = _ensureMission(params.missionId);
    if (!missionRef.ok) return missionRef;
    const { mission, missionId } = missionRef;

    if (TERMINAL_STATUSES.has(String(mission.status || '').toUpperCase())) {
        return {
            ok: false,
            statusCode: 409,
            code: 'MISSION_TERMINAL',
            error: 'Missão terminal não pode receber atualização de progresso',
            details: { status: mission.status },
        };
    }

    const preconditionFailure = _verifyProgressPreconditions(mission, params.expectedProgress || {});
    if (preconditionFailure) {
        _recordMissionEvent({
            missionId,
            eventType: 'MISSION_PROGRESS_UPDATE_REJECTED',
            actorType: params.actorType || 'system',
            actorId: params.actorId || null,
            payload: {
                reason: preconditionFailure.code,
                ...preconditionFailure.details,
            },
            dedupKey: params.dedupKey ? `${params.dedupKey}:rejected` : null,
        });
        return preconditionFailure;
    }

    const context = mission.context && typeof mission.context === 'object' ? mission.context : {};
    const nextContext = {
        ...context,
        ...(params.contextPatch && typeof params.contextPatch === 'object' ? params.contextPatch : {}),
        progress: {
            ...(context.progress && typeof context.progress === 'object' ? context.progress : {}),
            ...(params.progress && typeof params.progress === 'object' ? params.progress : {}),
        },
    };

    const updated = updateMission(missionId, { context: nextContext });

    _recordMissionEvent({
        missionId,
        eventType: params.eventType || 'MISSION_PROGRESS_UPDATED',
        actorType: params.actorType || 'system',
        actorId: params.actorId || null,
        payload: params.payload || {},
        dedupKey: params.dedupKey || null,
    });

    return { ok: true, mission: updated };
}

function executeMissionTransition({ missionId, actorType = 'user', actorId = null, dedupKey = null, payload = {} }) {
    const mission = getMissionById(missionId);
    const now = Date.now();
    return transitionMission({
        missionId,
        toStatus: MISSION_STATUS.RUNNING,
        allowedFrom: [MISSION_STATUS.READY, MISSION_STATUS.PAUSED],
        startedAtMs: mission?.started_at ? Date.parse(mission.started_at) : now,
        actorType,
        actorId,
        eventType: 'MISSION_EXECUTED',
        dedupKey,
        payload,
    });
}

function pauseMissionTransition({ missionId, actorType = 'user', actorId = null, dedupKey = null, payload = {} }) {
    return transitionMission({
        missionId,
        toStatus: MISSION_STATUS.PAUSED,
        allowedFrom: [MISSION_STATUS.RUNNING],
        actorType,
        actorId,
        eventType: 'MISSION_PAUSED',
        dedupKey,
        payload,
        taskMutation(db, now) {
            db.prepare(
                `
                UPDATE tasks
                SET status = 'PAUSED',
                    paused_at_ms = @now,
                    updated_at_ms = @now
                WHERE mission_id = @mission_id
                  AND stage = 'READY'
                  AND status IN ('PENDING', 'RUNNING')
            `
            ).run({ now, mission_id: missionId });
        },
    });
}

function resumeMissionTransition({ missionId, actorType = 'user', actorId = null, dedupKey = null, payload = {} }) {
    const mission = getMissionById(missionId);
    const now = Date.now();
    return transitionMission({
        missionId,
        toStatus: MISSION_STATUS.RUNNING,
        allowedFrom: [MISSION_STATUS.PAUSED],
        startedAtMs: mission?.started_at ? Date.parse(mission.started_at) : now,
        actorType,
        actorId,
        eventType: 'MISSION_RESUMED',
        dedupKey,
        payload,
        taskMutation(db, ts) {
            db.prepare(
                `
                UPDATE tasks
                SET status = 'PENDING',
                    paused_at_ms = NULL,
                    updated_at_ms = @now
                WHERE mission_id = @mission_id
                  AND stage = 'READY'
                  AND status = 'PAUSED'
            `
            ).run({ now: ts, mission_id: missionId });
        },
    });
}

function cancelMissionTransition({ missionId, actorType = 'user', actorId = null, dedupKey = null, payload = {} }) {
    return transitionMission({
        missionId,
        toStatus: MISSION_STATUS.CANCELLED,
        allowedFrom: [MISSION_STATUS.READY, MISSION_STATUS.RUNNING, MISSION_STATUS.PAUSED, MISSION_STATUS.FAILED],
        completedAtMs: Date.now(),
        actorType,
        actorId,
        eventType: 'MISSION_CANCELLED',
        dedupKey,
        payload,
        taskMutation(db, now) {
            db.prepare(
                `
                UPDATE tasks
                SET status = 'CANCELLED',
                    cancelled_at_ms = @now,
                    updated_at_ms = @now,
                    last_error = COALESCE(last_error, 'MISSION_CANCELLED')
                WHERE mission_id = @mission_id
                  AND status IN ('PENDING', 'RUNNING', 'PAUSED', 'FAILED')
            `
            ).run({ now, mission_id: missionId });
        },
    });
}

function failMissionTransition({
    missionId,
    failureReason,
    contextPatch = null,
    expectedProgress = null,
    actorType = 'system',
    actorId = null,
    dedupKey = null,
    payload = {},
}) {
    return transitionMission({
        missionId,
        toStatus: MISSION_STATUS.FAILED,
        allowedFrom: [MISSION_STATUS.RUNNING, MISSION_STATUS.PAUSED, MISSION_STATUS.READY],
        completedAtMs: Date.now(),
        contextPatch,
        failureReason,
        expectedProgress,
        actorType,
        actorId,
        eventType: 'MISSION_FAILED',
        dedupKey,
        payload,
    });
}

function completeMissionTransition({
    missionId,
    contextPatch = null,
    expectedProgress = null,
    actorType = 'system',
    actorId = null,
    dedupKey = null,
    payload = {},
}) {
    return transitionMission({
        missionId,
        toStatus: MISSION_STATUS.DONE,
        allowedFrom: [MISSION_STATUS.RUNNING],
        completedAtMs: Date.now(),
        contextPatch,
        expectedProgress,
        actorType,
        actorId,
        eventType: 'MISSION_COMPLETED',
        dedupKey,
        payload,
    });
}

export {
    MISSION_STATUS,
    cancelMissionTransition,
    completeMissionTransition,
    executeMissionTransition,
    failMissionTransition,
    pauseMissionTransition,
    resumeMissionTransition,
    transitionMission,
    updateMissionProgressState,
};
