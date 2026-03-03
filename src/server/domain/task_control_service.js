// @ts-check
import * as schemas from '#core/schemas';
import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { getMissionById } from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';
import { getTaskById, insertTask, purgeTask, releaseTaskLock, TASK_STAGES, updateTask } from '#infra/db/task_repo';
import { asRecord } from '#types/guards';
import { v4 as uuidv4 } from 'uuid';

const TERMINAL_TASK = new Set(['DONE', 'FAILED', 'CANCELLED', 'SKIPPED']);

function _now() {
    return Date.now();
}

function _error(statusCode, code, message, details = null) {
    const err = new Error(message || code);
    err.statusCode = Number(statusCode) || 500;
    err.code = String(code || 'TASK_CONTROL_ERROR');
    err.details = details;
    return err;
}

function _safeJsonParse(raw, fallback = {}) {
    if (!raw) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch (_) {
        return fallback;
    }
}

function _readTaskRowTx(db, taskId) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(taskId || '').trim());
    if (!row) {
        throw _error(404, 'TASK_NOT_FOUND', 'Task não encontrada');
    }
    return row;
}

function _assertIfVersion(row, ifVersion) {
    if (ifVersion === undefined || ifVersion === null) return;
    const expected = Number(ifVersion);
    const actual = Number(row.updated_at_ms || 0);
    if (!Number.isFinite(expected) || expected !== actual) {
        throw _error(412, 'TASK_VERSION_PRECONDITION_FAILED', 'Versão da task divergiu', {
            expected_if_version: expected,
            actual_version: actual,
        });
    }
}

function _assertPauseToEditTask(row) {
    const status = String(row.status || '').toUpperCase();
    const canEditPendingNotStarted =
        status === 'PENDING' &&
        Number(row.attempts || 0) === 0 &&
        !row.started_at_ms &&
        row.stage === TASK_STAGES.READY;

    if (status !== 'PAUSED' && !canEditPendingNotStarted) {
        throw _error(
            409,
            'TASK_EDIT_REQUIRES_PAUSED',
            'Edição livre de task só é permitida em PAUSED (ou READY não iniciada)',
            {
                status,
                stage: row.stage,
                attempts: Number(row.attempts || 0),
            }
        );
    }
}

function _buildTaskV5FromPayload(payload = {}) {
    const nowIso = new Date().toISOString();
    const providedId = payload?.meta?.id ? String(payload.meta.id) : null;
    const taskId = (providedId || `task-${uuidv4()}`).replace(/[^a-zA-Z0-9._-]/g, '');

    const target = String(payload?.spec?.target || payload?.target || 'auto')
        .toLowerCase()
        .trim();
    const task = schemas.core.TaskSchemaV5.parse({
        meta: {
            id: taskId,
            version: '5.0',
            created_at: payload?.meta?.created_at || nowIso,
            priority: Number(payload?.meta?.priority ?? payload?.priority ?? 5) || 5,
            source: String(payload?.meta?.source || 'dashboard_control'),
            mission_id: payload?.meta?.mission_id || payload?.mission_id || undefined,
            workflow_id: payload?.meta?.workflow_id || payload?.workflow_id || undefined,
            parent_id: payload?.meta?.parent_id || payload?.parent_task_id || undefined,
            correlation_id: payload?.meta?.correlation_id || payload?.correlation_id || undefined,
            tags: Array.isArray(payload?.meta?.tags) ? payload.meta.tags : [],
        },
        spec: {
            target,
            model: payload?.spec?.model || payload?.model || undefined,
            payload: {
                system_message: String(payload?.spec?.payload?.system_message || payload?.system_message || ''),
                user_message: String(payload?.spec?.payload?.user_message || payload?.user_message || ''),
                context: payload?.spec?.payload?.context || payload?.context || undefined,
            },
            execution: payload?.spec?.execution || undefined,
            validation: payload?.spec?.validation || undefined,
            parameters: payload?.spec?.parameters || undefined,
            context_config: payload?.spec?.context_config || undefined,
            config: payload?.spec?.config || undefined,
        },
        policy: {
            max_attempts: payload?.policy?.max_attempts ?? undefined,
            timeout_ms: payload?.policy?.timeout_ms ?? undefined,
            execute_after: payload?.policy?.execute_after ?? undefined,
            dependencies: Array.isArray(payload?.policy?.dependencies) ? payload.policy.dependencies : [],
        },
        mission: payload?.mission || undefined,
        state: {
            status: 'PENDING',
        },
        result: {},
    });

    return task;
}

function _recordTaskEvent({ taskId, actor, eventType, reason, payload = {} }) {
    try {
        recordEvent({
            entityType: 'task',
            entityId: String(taskId),
            actorType: 'user',
            actorId: actor?.id || actor?.username || null,
            eventType,
            payload: {
                reason,
                ...payload,
            },
            dedupKey: `task:${taskId}:${eventType}:${Date.now()}`,
        });
    } catch (err) {
        log('WARN', `[TaskControl] Falha ao registrar evento ${eventType}: ${err?.message || String(err)}`);
    }
}

function _recordMissionEvent({ missionId, actor, eventType, reason, payload = {} }) {
    if (!missionId) return;
    try {
        recordEvent({
            entityType: 'mission',
            entityId: String(missionId),
            actorType: 'user',
            actorId: actor?.id || actor?.username || null,
            eventType,
            payload: {
                reason,
                ...payload,
            },
            dedupKey: `mission:${missionId}:${eventType}:${Date.now()}`,
        });
    } catch (err) {
        log(
            'WARN',
            `[TaskControl] Falha ao registrar evento ${eventType} na mission ${missionId}: ${err?.message || String(err)}`
        );
    }
}

function _hasOwn(obj, key) {
    return Boolean(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key));
}

function _patchTouchesMissionBinding(patch = {}) {
    if (_hasOwn(patch, 'mission_id')) return true;
    if (_hasOwn(patch, 'missionId')) return true;
    if (_hasOwn(patch, 'parent_id') || _hasOwn(patch, 'workflow_id')) return true;
    if (_hasOwn(patch, 'parentId') || _hasOwn(patch, 'workflowId')) return true;
    if (_hasOwn(patch, 'meta')) {
        const meta = patch.meta;
        if (
            _hasOwn(meta, 'mission_id') ||
            _hasOwn(meta, 'missionId') ||
            _hasOwn(meta, 'parent_id') ||
            _hasOwn(meta, 'workflow_id')
        ) {
            return true;
        }
    }
    if (_hasOwn(patch, 'mission')) {
        const mission = patch.mission;
        if (
            _hasOwn(mission, 'mission_id') ||
            _hasOwn(mission, 'missionId') ||
            _hasOwn(mission, 'step_id') ||
            _hasOwn(mission, 'stepId')
        ) {
            return true;
        }
    }
    return false;
}

function _isReadyNotStarted(row) {
    return (
        String(row.status || '').toUpperCase() === 'PENDING' &&
        String(row.stage || '').toUpperCase() === TASK_STAGES.READY &&
        Number(row.attempts || 0) === 0 &&
        !row.started_at_ms
    );
}

function _assertTaskMissionReassignEligibility(row) {
    const status = String(row.status || '').toUpperCase();
    if (status === 'PAUSED') return;
    if (_isReadyNotStarted(row)) return;
    throw _error(
        409,
        'TASK_REASSIGN_REQUIRES_PAUSED_OR_READY_NOT_STARTED',
        'Reassign de missão só é permitido em PAUSED ou READY não iniciada',
        {
            status,
            stage: String(row.stage || '').toUpperCase(),
            attempts: Number(row.attempts || 0),
            started_at_ms: row.started_at_ms ?? null,
        }
    );
}

function _assertMissionDestinationAllowed(destination, missionId) {
    if (!destination) {
        throw _error(404, 'MISSION_NOT_FOUND', 'Missão de destino não encontrada', { mission_id: missionId });
    }
    const status = String(destination.status || '').toUpperCase();
    if (['CANCELLED', 'DONE', 'FAILED'].includes(status)) {
        throw _error(409, 'TASK_REASSIGN_MISSION_TERMINAL', 'Missão de destino está em estado terminal', {
            mission_id: missionId,
            status,
        });
    }
}

function _isTaskBoundToMissionStep(db, row, task) {
    const taskMission = task?.mission || _safeJsonParse(row.task_json, {})?.mission || {};
    const stepId = taskMission?.step_id || taskMission?.stepId || null;
    if (stepId) return true;

    const hasMissionStepsTable = db
        .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'mission_steps' LIMIT 1")
        .get();
    if (!hasMissionStepsTable) return false;

    const binding = db
        .prepare(
            `
            SELECT id
            FROM mission_steps
            WHERE current_task_id = @task_id OR last_task_id = @task_id
            LIMIT 1
        `
        )
        .get({ task_id: row.id });
    return Boolean(binding);
}

/**
 * Função exportada: createTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function createTaskCommand({ actor = {}, reason, payload = {}, ifNotExists = false }) {
    const actorView = asRecord(actor);
    const payloadView = asRecord(payload);
    const task = _buildTaskV5FromPayload(payloadView);
    const stage = String(payloadView.stage || TASK_STAGES.READY).toUpperCase();
    const status = String(payloadView.status || 'PENDING').toUpperCase();
    const created = insertTask(task, {
        stage,
        status,
        actor: String(actorView.username || actorView.id || 'user'),
        ifNotExists,
    });

    _recordTaskEvent({
        taskId: created?.meta?.id || task.meta.id,
        actor,
        eventType: 'TASK_CREATED_BY_CONTROL',
        reason,
        payload: {
            stage,
            status,
            mission_id: created?.meta?.mission_id || task.meta?.mission_id || null,
        },
    });

    return {
        before: null,
        after: created,
        metadata: {},
    };
}

/**
 * Função exportada: patchTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function patchTaskCommand({ taskId, actor = {}, reason, ifVersion = null, patch = {} }) {
    const patchView = asRecord(patch);
    const db = getDb();
    const row = _readTaskRowTx(db, taskId);
    _assertIfVersion(row, ifVersion);
    _assertPauseToEditTask(row);
    if (_patchTouchesMissionBinding(patchView)) {
        throw _error(
            422,
            'TASK_MISSION_REASSIGN_USE_COMMAND',
            'Use TASK_REASSIGN_MISSION para alterar vínculo de missão/workflow/parent da task'
        );
    }

    const existingTask = getTaskById(taskId);
    if (!existingTask) {
        throw _error(404, 'TASK_NOT_FOUND', 'Task não encontrada');
    }

    const nextTask = {
        ...existingTask,
        meta: {
            ...(existingTask.meta || {}),
            ...(patchView.meta && typeof patchView.meta === 'object' ? patchView.meta : {}),
            priority:
                patchView.priority !== undefined
                    ? Number(patchView.priority) || Number(existingTask?.meta?.priority || 5)
                    : Number(existingTask?.meta?.priority || 5),
        },
        spec: {
            ...(existingTask.spec || {}),
            ...(patchView.spec && typeof patchView.spec === 'object' ? patchView.spec : {}),
            target:
                patchView.target !== undefined
                    ? String(patchView.target).toLowerCase().trim()
                    : existingTask.spec?.target,
            model: patchView.model !== undefined ? patchView.model : existingTask.spec?.model,
            payload: {
                ...(existingTask.spec?.payload || {}),
                ...(() => {
                    const patchSpec = asRecord(patchView.spec);
                    return patchSpec.payload && typeof patchSpec.payload === 'object' ? patchSpec.payload : {};
                })(),
                ...(patchView.user_message !== undefined ? { user_message: String(patchView.user_message || '') } : {}),
                ...(patchView.system_message !== undefined
                    ? { system_message: String(patchView.system_message || '') }
                    : {}),
            },
        },
        policy: {
            ...(existingTask.policy || {}),
            ...(patchView.policy && typeof patchView.policy === 'object' ? patchView.policy : {}),
            ...(patchView.execute_after_ms !== undefined
                ? {
                      execute_after:
                          patchView.execute_after_ms === null
                              ? null
                              : new Date(Number(patchView.execute_after_ms) || Date.now()).toISOString(),
                  }
                : {}),
        },
    };

    const updated = updateTask(taskId, {
        task: nextTask,
        stage: patchView.stage ? String(patchView.stage).toUpperCase() : undefined,
        status: patchView.status ? String(patchView.status).toUpperCase() : undefined,
        execute_after_ms: patchView.execute_after_ms,
        dependencies: patchView.dependencies,
        blocked_reason: patchView.blocked_reason,
        blocked_details_json:
            patchView.blocked_details !== undefined ? JSON.stringify(patchView.blocked_details ?? null) : undefined,
    });
    const updatedView = /** @type {unknown} */ (updated);

    _recordTaskEvent({
        taskId,
        actor,
        eventType: 'TASK_PATCHED_BY_CONTROL',
        reason,
        payload: {
            from_status: row.status,
            to_status: updatedView?.unified_status || row.status,
        },
    });

    return {
        before: _safeJsonParse(row.task_json, {}),
        after: updated,
        metadata: {},
    };
}

/**
 * Função exportada: reassignTaskMissionCommand.
 * @returns {Promise<object>|object|null}
 */
function reassignTaskMissionCommand({ taskId, missionId, actor = {}, reason, ifVersion = null }) {
    const destinationMissionId = missionId === null || missionId === undefined ? '' : String(missionId).trim();
    if (!destinationMissionId) {
        throw _error(422, 'TASK_REASSIGN_MISSION_REQUIRED', 'mission_id de destino é obrigatório');
    }

    const db = getDb();
    const row = _readTaskRowTx(db, taskId);
    _assertIfVersion(row, ifVersion);
    _assertTaskMissionReassignEligibility(row);

    const sourceMissionId = row.mission_id ? String(row.mission_id) : null;
    if (sourceMissionId && sourceMissionId === destinationMissionId) {
        throw _error(409, 'TASK_REASSIGN_NOOP', 'Task já pertence à missão de destino', {
            mission_id: destinationMissionId,
        });
    }

    const destinationMission = getMissionById(destinationMissionId);
    _assertMissionDestinationAllowed(destinationMission, destinationMissionId);

    const existingTask = getTaskById(taskId);
    if (!existingTask) {
        throw _error(404, 'TASK_NOT_FOUND', 'Task não encontrada');
    }

    if (_isTaskBoundToMissionStep(db, row, existingTask)) {
        throw _error(
            423,
            'TASK_REASSIGN_BLOCKED_BY_MISSION_STEP',
            'Task vinculada a step de missão ativa não pode ser reatribuída',
            { task_id: taskId }
        );
    }

    const nextTask = {
        ...existingTask,
        meta: {
            ...(existingTask.meta || {}),
            mission_id: destinationMissionId,
            parent_id: undefined,
            workflow_id: undefined,
        },
        mission: {
            ...(existingTask.mission || {}),
            mission_id: destinationMissionId,
        },
    };
    delete nextTask?.mission?.step_id;
    delete nextTask?.mission?.stepId;
    if (nextTask.meta) {
        delete nextTask.meta.parent_id;
        delete nextTask.meta.workflow_id;
    }

    const updated = updateTask(taskId, { task: nextTask });

    _recordTaskEvent({
        taskId,
        actor,
        eventType: 'TASK_REASSIGNED_MISSION',
        reason,
        payload: {
            from_mission_id: sourceMissionId,
            to_mission_id: destinationMissionId,
        },
    });
    _recordMissionEvent({
        missionId: destinationMissionId,
        actor,
        eventType: 'MISSION_TASK_ATTACHED',
        reason,
        payload: {
            task_id: taskId,
            from_mission_id: sourceMissionId,
        },
    });
    _recordMissionEvent({
        missionId: sourceMissionId,
        actor,
        eventType: 'MISSION_TASK_DETACHED',
        reason,
        payload: {
            task_id: taskId,
            to_mission_id: destinationMissionId,
        },
    });

    return {
        before: _safeJsonParse(row.task_json, {}),
        after: updated,
        metadata: {
            from_mission_id: sourceMissionId,
            to_mission_id: destinationMissionId,
        },
    };
}

/**
 * Função exportada: pauseTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function pauseTaskCommand({ taskId, actor = {}, reason, ifVersion = null }) {
    const db = getDb();
    const row = _readTaskRowTx(db, taskId);
    _assertIfVersion(row, ifVersion);

    if (String(row.status || '').toUpperCase() === 'PAUSED') {
        throw _error(409, 'TASK_TRANSITION_NOOP', 'Task já está pausada');
    }

    const updated = updateTask(taskId, {
        status: 'PAUSED',
        paused_at_ms: _now(),
    });

    try {
        releaseTaskLock({ taskId });
    } catch (_) {
        // best effort
    }

    _recordTaskEvent({ taskId, actor, eventType: 'TASK_PAUSED_BY_CONTROL', reason });

    return {
        before: _safeJsonParse(row.task_json, {}),
        after: updated,
        metadata: {},
    };
}

/**
 * Função exportada: resumeTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function resumeTaskCommand({ taskId, actor = {}, reason, ifVersion = null }) {
    const db = getDb();
    const row = _readTaskRowTx(db, taskId);
    _assertIfVersion(row, ifVersion);

    const status = String(row.status || '').toUpperCase();
    // BUG-RESUME-DONE: DONE is a terminal success state — it should not be resumable.
    // Use TASK_RETRY to intentionally re-execute a completed task.
    if (!['PAUSED', 'BLOCKED', 'CANCELLED', 'FAILED'].includes(status)) {
        throw _error(409, 'TASK_RESUME_INVALID', `Task em status ${status} não pode ser retomada`);
    }

    const updated = updateTask(taskId, {
        status: 'PENDING',
        stage: TASK_STAGES.READY,
        paused_at_ms: null,
        cancelled_at_ms: null,
        failed_at_ms: null,
        completed_at_ms: null,
        blocked_reason: null,
        blocked_at_ms: null,
        blocked_details_json: null,
        last_error: null,
    });

    try {
        releaseTaskLock({ taskId });
    } catch (_) {
        // best effort
    }

    _recordTaskEvent({ taskId, actor, eventType: 'TASK_RESUMED_BY_CONTROL', reason });

    return {
        before: _safeJsonParse(row.task_json, {}),
        after: updated,
        metadata: {},
    };
}

/**
 * Função exportada: cancelTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function cancelTaskCommand({ taskId, actor = {}, reason, ifVersion = null }) {
    const db = getDb();
    const row = _readTaskRowTx(db, taskId);
    _assertIfVersion(row, ifVersion);

    const status = String(row.status || '').toUpperCase();
    if (status === 'CANCELLED') {
        throw _error(409, 'TASK_TRANSITION_NOOP', 'Task já cancelada');
    }
    if (TERMINAL_TASK.has(status) && status !== 'CANCELLED') {
        throw _error(409, 'TASK_TERMINAL', `Task terminal (${status}) não pode ser cancelada`);
    }

    const updated = updateTask(taskId, {
        status: 'CANCELLED',
        cancelled_at_ms: _now(),
        last_error: 'USER_CANCELLED',
    });

    try {
        releaseTaskLock({ taskId });
    } catch (_) {
        // best effort
    }

    _recordTaskEvent({ taskId, actor, eventType: 'TASK_CANCELLED_BY_CONTROL', reason });

    return {
        before: _safeJsonParse(row.task_json, {}),
        after: updated,
        metadata: {},
    };
}

/**
 * Função exportada: retryTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function retryTaskCommand({ taskId, actor = {}, reason, ifVersion = null }) {
    const db = getDb();
    const row = _readTaskRowTx(db, taskId);
    _assertIfVersion(row, ifVersion);

    const status = String(row.status || '').toUpperCase();
    if (status === 'RUNNING') {
        throw _error(409, 'TASK_RETRY_REQUIRES_NOT_RUNNING', 'Task em execução não pode ser reexecutada');
    }

    const updated = updateTask(taskId, {
        status: 'PENDING',
        stage: TASK_STAGES.READY,
        paused_at_ms: null,
        cancelled_at_ms: null,
        failed_at_ms: null,
        completed_at_ms: null,
        last_error: null,
        blocked_reason: null,
        blocked_at_ms: null,
        blocked_details_json: null,
    });

    try {
        releaseTaskLock({ taskId });
    } catch (_) {
        // best effort
    }

    _recordTaskEvent({ taskId, actor, eventType: 'TASK_RETRIED_BY_CONTROL', reason });

    return {
        before: _safeJsonParse(row.task_json, {}),
        after: updated,
        metadata: {},
    };
}

/**
 * Função exportada: purgeTaskCommand.
 * @returns {Promise<object>|object|null}
 */
function purgeTaskCommand({ taskId, actor = {}, reason }) {
    const before = getTaskById(taskId);
    if (!before) {
        throw _error(404, 'TASK_NOT_FOUND', 'Task não encontrada');
    }

    const deleted = purgeTask(taskId);
    if (!deleted) {
        throw _error(500, 'TASK_PURGE_FAILED', 'Falha ao purgar task');
    }

    _recordTaskEvent({ taskId, actor, eventType: 'TASK_PURGED_BY_CONTROL', reason });

    return {
        before,
        after: null,
        metadata: { deleted: true },
    };
}

/**
 * Função exportada: bulkTaskActionCommand.
 * @returns {Promise<object>|object|null}
 */
function bulkTaskActionCommand({ ids = [], action, params = {}, actor = {}, reason }) {
    const normalized = Array.isArray(ids) ? ids.map(id => String(id)).filter(Boolean) : [];
    const paramsView = asRecord(params);
    if (normalized.length === 0) {
        throw _error(400, 'TASK_BULK_IDS_REQUIRED', 'ids vazio');
    }

    const results = [];
    const failed = [];

    for (const taskId of normalized) {
        try {
            let result;
            switch (String(action || '').toUpperCase()) {
                case 'PAUSE':
                    result = pauseTaskCommand({ taskId, actor, reason });
                    break;
                case 'RESUME':
                case 'UNBLOCK':
                    result = resumeTaskCommand({ taskId, actor, reason });
                    break;
                case 'RETRY':
                    result = retryTaskCommand({ taskId, actor, reason });
                    break;
                case 'CANCEL':
                    result = cancelTaskCommand({ taskId, actor, reason });
                    break;
                case 'PATCH':
                    result = patchTaskCommand({ taskId, actor, reason, patch: params || {} });
                    break;
                case 'APPROVE':
                    result = patchTaskCommand({ taskId, actor, reason, patch: { stage: 'READY' } });
                    break;
                case 'REJECT':
                    result = patchTaskCommand({ taskId, actor, reason, patch: { stage: 'REJECTED' } });
                    break;
                case 'SET_STAGE':
                    result = patchTaskCommand({ taskId, actor, reason, patch: { stage: paramsView.stage } });
                    break;
                case 'SET_TARGET':
                    result = patchTaskCommand({ taskId, actor, reason, patch: { target: paramsView.target } });
                    break;
                case 'SET_PRIORITY':
                    result = patchTaskCommand({ taskId, actor, reason, patch: { priority: paramsView.priority } });
                    break;
                case 'SET_EXECUTE_AFTER':
                    result = patchTaskCommand({
                        taskId,
                        actor,
                        reason,
                        patch: {
                            execute_after_ms: paramsView.execute_after_ms ?? null,
                        },
                    });
                    break;
                case 'SET_DEPENDENCIES':
                    result = patchTaskCommand({
                        taskId,
                        actor,
                        reason,
                        patch: {
                            dependencies: paramsView.dependencies || [],
                        },
                    });
                    break;
                case 'REASSIGN_MISSION':
                    result = reassignTaskMissionCommand({
                        taskId,
                        missionId: paramsView.mission_id,
                        actor,
                        reason,
                        ifVersion: paramsView.if_version,
                    });
                    break;
                default:
                    throw _error(422, 'TASK_BULK_ACTION_INVALID', `Ação não suportada: ${action}`);
            }
            results.push({ id: taskId, ok: true, result });
        } catch (err) {
            failed.push({
                id: taskId,
                ok: false,
                code: err?.code || 'TASK_BULK_ITEM_FAILED',
                error: err?.message || String(err),
            });
        }
    }

    return {
        before: null,
        after: null,
        metadata: {
            total: normalized.length,
            ok: results.length,
            failed,
        },
    };
}

export {
    bulkTaskActionCommand,
    cancelTaskCommand,
    createTaskCommand,
    patchTaskCommand,
    pauseTaskCommand,
    purgeTaskCommand,
    reassignTaskMissionCommand,
    resumeTaskCommand,
    retryTaskCommand,
};
