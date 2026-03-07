// @ts-check
import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { STEP_STATUS, syncMissionStepsFromWorkflow } from '#infra/db/mission_step_repo';
import { AUTONOMY_MODES, createMission } from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';
import { asRecord } from '#types/guards';

/** Constante/valor exportado: MISSION_STATUS. */
const MISSION_STATUS = Object.freeze({
    READY: 'READY',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
});

/** @type {Set<string>} */
const TERMINAL_MISSION = new Set([MISSION_STATUS.DONE, MISSION_STATUS.FAILED, MISSION_STATUS.CANCELLED]);
/** @type {Set<string>} */
const EDITABLE_MISSION = new Set([MISSION_STATUS.READY, MISSION_STATUS.PAUSED]);

function _now() {
    return Date.now();
}

function _safeJsonParse(/** @type {any} */ raw, fallback = {}) {
    if (!raw) return fallback;
    try {
        return JSON.parse(String(raw));
    } catch (/** @type {any} */ _) {
        return fallback;
    }
}

function _safeJsonString(/** @type {any} */ value, fallback = '{}') {
    try {
        return JSON.stringify(value ?? {});
    } catch (/** @type {any} */ _) {
        return fallback;
    }
}

function _error(/** @type {any} */ statusCode, /** @type {any} */ code, /** @type {any} */ message, /** @type {any} */ details = null) {
    const err = new Error(message || code);
    err.statusCode = Number(statusCode) || 500;
    err.code = String(code || 'MISSION_CONTROL_ERROR');
    (/** @type {any} */ (err)).details = details;
    return err;
}

function _assertIfVersion(/** @type {any} */ row, /** @type {any} */ ifVersion) {
    if (ifVersion === undefined || ifVersion === null) return;
    const expected = Number(ifVersion);
    const actual = Number(row.updated_at_ms || 0);
    if (!Number.isFinite(expected) || expected !== actual) {
        throw _error(412, 'MISSION_VERSION_PRECONDITION_FAILED', 'Versão da missão divergiu', {
            expected_if_version: expected,
            actual_version: actual,
        });
    }
}

function _readMissionRowTx(/** @type {any} */ db, /** @type {any} */ missionId) {
    const row = db.prepare('SELECT * FROM missions WHERE id = ?').get(String(missionId || '').trim());
    if (!row) {
        throw _error(404, 'MISSION_NOT_FOUND', 'Missão não encontrada');
    }
    return row;
}

function _rowToMission(/** @type {any} */ row) {
    return {
        id: String(row.id),
        title: String(row.title || ''),
        description: String(row.description || ''),
        status: String(row.status || MISSION_STATUS.READY),
        autonomy_mode: String(row.autonomy_mode || 'USER_ONLY'),
        policy: _safeJsonParse(row.policy_json, {}),
        context: _safeJsonParse(row.context_json, {}),
        created_at_ms: Number(row.created_at_ms) || 0,
        updated_at_ms: Number(row.updated_at_ms) || 0,
        started_at_ms: row.started_at_ms === null || row.started_at_ms === undefined ? null : Number(row.started_at_ms),
        completed_at_ms:
            row.completed_at_ms === null || row.completed_at_ms === undefined ? null : Number(row.completed_at_ms),
    };
}

function _updateMissionTx(/** @type {any} */ db, /** @type {any} */ row, /** @type {any} */ updates) {
    const now = _now();
    const next = {
        title: updates.title !== undefined ? String(updates.title || '') : row.title,
        description: updates.description !== undefined ? String(updates.description || '') : row.description,
        status: updates.status !== undefined ? String(updates.status) : row.status,
        autonomy_mode: updates.autonomy_mode !== undefined ? String(updates.autonomy_mode) : row.autonomy_mode,
        policy_json: updates.policy_json !== undefined ? updates.policy_json : row.policy_json,
        context_json: updates.context_json !== undefined ? updates.context_json : row.context_json,
        started_at_ms: updates.started_at_ms !== undefined ? updates.started_at_ms : row.started_at_ms,
        completed_at_ms: updates.completed_at_ms !== undefined ? updates.completed_at_ms : row.completed_at_ms,
        updated_at_ms: now,
        id: row.id,
    };

    db.prepare(
        `
        UPDATE missions
        SET title = @title,
            description = @description,
            status = @status,
            autonomy_mode = @autonomy_mode,
            policy_json = @policy_json,
            context_json = @context_json,
            started_at_ms = @started_at_ms,
            completed_at_ms = @completed_at_ms,
            updated_at_ms = @updated_at_ms
        WHERE id = @id
    `
    ).run(next);

    return db.prepare('SELECT * FROM missions WHERE id = ?').get(row.id);
}

function _assertAllowedTransition(/** @type {any} */ fromStatus, /** @type {any} */ allowedFrom, /** @type {any} */ toStatus) {
    const from = String(fromStatus || '').toUpperCase();
    if (from === String(toStatus || '').toUpperCase()) {
        throw _error(409, 'MISSION_TRANSITION_NOOP', `Missão já está em ${toStatus}`);
    }
    if (!allowedFrom.includes(from)) {
        throw _error(409, 'MISSION_TRANSITION_INVALID', `Transição inválida: ${from} -> ${toStatus}`, {
            from,
            to: toStatus,
            allowed_from: allowedFrom,
        });
    }
}

function _syncMissionStepsForMission(/** @type {any} */ mission) {
    try {
        const workflow = mission?.context?.workflow || null;
        if (workflow && Array.isArray(workflow.steps) && workflow.steps.length > 0) {
            syncMissionStepsFromWorkflow(mission.id, workflow);
        }
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('WARN', `[MissionControl] Falha ao sincronizar mission_steps: ${_e?.message || String(_e)}`);
    }
}

function _setActiveStepsStatusTx(/** @type {any} */ db, /** @type {any} */ missionId, /** @type {any} */ status) {
    db.prepare(
        `
        UPDATE mission_steps
        SET status = @status,
            current_task_id = CASE WHEN @status = @running THEN current_task_id ELSE NULL END,
            updated_at_ms = @updated_at_ms,
            version = version + 1
        WHERE mission_id = @mission_id
          AND status IN ('PENDING', 'RUNNING', 'PAUSED')
    `
    ).run({
        mission_id: missionId,
        status,
        running: STEP_STATUS.RUNNING,
        updated_at_ms: _now(),
    });
}

function _cancelMissionTasksCascadeTx(/** @type {any} */ db, /** @type {any} */ missionId) {
    const rows = db
        .prepare(
            `
            SELECT id
            FROM tasks
            WHERE mission_id = ?
              AND status IN ('PENDING', 'RUNNING', 'PAUSED', 'BLOCKED')
        `
        )
        .all(missionId);

    const affectedTaskIds = rows.map((/** @type {any} */ row) => String(row.id));
    if (affectedTaskIds.length === 0) return affectedTaskIds;

    const now = _now();
    const stmt = db.prepare(
        `
        UPDATE tasks
        SET status = 'CANCELLED',
            cancelled_at_ms = @now,
            lock_expires_at_ms = NULL,
            locked_at_ms = NULL,
            locked_by = NULL,
            updated_at_ms = @now,
            last_error = 'MISSION_CANCELLED_CASCADE'
        WHERE id = @id
    `
    );

    for (const taskId of affectedTaskIds) {
        stmt.run({ id: taskId, now });
    }

    return affectedTaskIds;
}

/**
 * Cascades mission pause to PENDING tasks: marks them PAUSED so the queue
 * worker won't pick them up AND the UI shows a consistent state.
 * RUNNING tasks are intentionally left running — the SQL gate in
 * claimNextEligibleTask (mission_id IS NULL OR m.status = 'RUNNING') already
 * prevents new tasks from being dispatched while the mission is PAUSED.
 * @param {import('better-sqlite3').Database} db
 * @param {string} missionId
 * @returns {string[]} affected task IDs
 */
function _pauseMissionPendingTasksTx(db, missionId) {
    const now = _now();
    // BUG-CASCADE-RESUME: always set last_error = 'MISSION_PAUSED_CASCADE' regardless of any
    // pre-existing last_error so that _resumeMissionCascadedTasksTx (which filters on this marker)
    // can reliably revert the pause. The original error is preserved inside task_json.state and
    // the events table, so diagnostic info is not lost.
    db.prepare(
        `
        UPDATE tasks
        SET status = 'PAUSED',
            paused_at_ms = @now,
            updated_at_ms = @now,
            last_error = 'MISSION_PAUSED_CASCADE'
        WHERE mission_id = @mission_id
          AND status = 'PENDING'
          AND stage = 'READY'
    `
    ).run({ mission_id: missionId, now });

    const paused = db
        .prepare(
            `SELECT id FROM tasks WHERE mission_id = ? AND status = 'PAUSED' AND last_error = 'MISSION_PAUSED_CASCADE'`
        )
        .all(missionId);
    return paused.map((/** @type {any} */ r) => String(r.id));
}

/**
 * Reverses _pauseMissionPendingTasksTx: restores tasks that were paused
 * specifically due to the mission cascade back to PENDING so they're
 * eligible for dispatch again.
 * Tasks explicitly paused by the user (last_error != 'MISSION_PAUSED_CASCADE')
 * are intentionally left PAUSED to honour the user's intent.
 * @param {import('better-sqlite3').Database} db
 * @param {string} missionId
 * @returns {string[]} affected task IDs
 */
function _resumeMissionCascadedTasksTx(db, missionId) {
    const now = _now();
    db.prepare(
        `
        UPDATE tasks
        SET status = 'PENDING',
            paused_at_ms = NULL,
            last_error = NULL,
            updated_at_ms = @now
        WHERE mission_id = @mission_id
          AND status = 'PAUSED'
          AND last_error = 'MISSION_PAUSED_CASCADE'
          AND stage = 'READY'
    `
    ).run({ mission_id: missionId, now });

    const resumed = db
        .prepare(
            `SELECT id FROM tasks
             WHERE mission_id = @mission_id
               AND status = 'PENDING'
               AND stage = 'READY'
               AND paused_at_ms IS NULL
               AND updated_at_ms >= @since`
        )
        .all({ mission_id: missionId, since: now - 5000 });
    return resumed.map((/** @type {any} */ r) => String(r.id));
}

function _recordMissionEvents(/** @type {any} */ {
    missionId,
    actorId,
    actorType = 'user',
    operation,
    before,
    after,
    reason,
    metadata = {},
}) {
    try {
        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType,
            actorId: actorId || null,
            eventType: operation,
            payload: {
                reason,
                before_status: before?.status || null,
                after_status: after?.status || null,
                ...metadata,
            },
            dedupKey: `mission:${missionId}:${operation}:${after?.updated_at_ms || Date.now()}`,
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('WARN', `[MissionControl] Falha ao registrar evento ${operation}: ${_e?.message || String(_e)}`);
    }
}

/** @typedef {any} CreateMissionCommandOptions */
/**
 * Função exportada: createMissionCommand.
 * @param {CreateMissionCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function createMissionCommand(/** @type {any} */ { actor = {}, reason, payload = {} }) {
    const actorView = asRecord(actor);
    const payloadView = asRecord(payload);
    const title = String(payloadView.title || '').trim();
    if (!title) {
        throw _error(422, 'MISSION_TITLE_REQUIRED', 'title é obrigatório para criar missão');
    }

    const description = String(payloadView.description || '');
    const autonomyModeRaw = payloadView.autonomy_mode ?? payloadView.autonomyMode ?? AUTONOMY_MODES.USER_ONLY;
    const autonomyModeValues = /** @type {string[]} */ (Object.values(AUTONOMY_MODES));
    const autonomyMode = autonomyModeValues.includes(String(autonomyModeRaw))
        ? String(autonomyModeRaw)
        : AUTONOMY_MODES.USER_ONLY;
    /** @type {Record<string, unknown>} */
    const policy = payloadView.policy && typeof payloadView.policy === 'object' ? asRecord(payloadView.policy) : {};
    /** @type {Record<string, unknown>} */
    const context = payloadView.context && typeof payloadView.context === 'object' ? asRecord(payloadView.context) : {};

    const created = createMission({
        title,
        description,
        autonomy_mode: autonomyMode,
        policy,
        context,
    });

    const db = getDb();
    const row = _readMissionRowTx(db, (/** @type {any} */ (created)).id);
    const after = _rowToMission(row);
    _syncMissionStepsForMission(after);

    _recordMissionEvents({
        missionId: after.id,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: 'MISSION_CREATE',
        before: null,
        after,
        reason,
        metadata: {
            autonomy_mode: after.autonomy_mode,
        },
    });

    return {
        before: null,
        after,
        metadata: {
            created: true,
        },
    };
}

/** @typedef {any} ExecuteMissionCommandOptions */
/**
 * Função exportada: executeMissionCommand.
 * @param {ExecuteMissionCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function executeMissionCommand(/** @type {any} */ { missionId, actor = {}, reason, ifVersion = null, command = 'MISSION_EXECUTE' }) {
    const actorView = asRecord(actor);
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);

        _assertAllowedTransition(row.status, [MISSION_STATUS.READY, MISSION_STATUS.PAUSED], MISSION_STATUS.RUNNING);

        const updatedRow = _updateMissionTx(db, row, {
            status: MISSION_STATUS.RUNNING,
            started_at_ms: row.started_at_ms || _now(),
            completed_at_ms: null,
        });

        _setActiveStepsStatusTx(db, missionId, STEP_STATUS.RUNNING);
        return { before: _rowToMission(row), after: _rowToMission(updatedRow), metadata: {} };
    })();

    _syncMissionStepsForMission(result.after);
    _recordMissionEvents({
        missionId,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: command,
        before: result.before,
        after: result.after,
        reason,
    });

    return result;
}

/** @typedef {any} PauseMissionCommandOptions */
/**
 * Função exportada: pauseMissionCommand.
 * @param {PauseMissionCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function pauseMissionCommand(/** @type {any} */ { missionId, actor = {}, reason, ifVersion = null }) {
    const actorView = asRecord(actor);
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);
        _assertAllowedTransition(row.status, [MISSION_STATUS.RUNNING], MISSION_STATUS.PAUSED);

        const updatedRow = _updateMissionTx(db, row, {
            status: MISSION_STATUS.PAUSED,
        });

        _setActiveStepsStatusTx(db, missionId, STEP_STATUS.PAUSED);
        const cascadedTaskIds = _pauseMissionPendingTasksTx(db, missionId);
        return {
            before: _rowToMission(row),
            after: _rowToMission(updatedRow),
            metadata: { cascaded_tasks: cascadedTaskIds },
        };
    })();

    _recordMissionEvents({
        missionId,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: 'MISSION_PAUSE',
        before: result.before,
        after: result.after,
        reason,
        metadata: {
            cascaded_tasks_count: result.metadata?.cascaded_tasks?.length || 0,
        },
    });

    return result;
}

/** @typedef {any} ResumeMissionCommandOptions */
/**
 * Função exportada: resumeMissionCommand.
 * @param {ResumeMissionCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function resumeMissionCommand(/** @type {any} */ { missionId, actor = {}, reason, ifVersion = null }) {
    const actorView = asRecord(actor);
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);
        _assertAllowedTransition(row.status, [MISSION_STATUS.PAUSED], MISSION_STATUS.RUNNING);

        const updatedRow = _updateMissionTx(db, row, {
            status: MISSION_STATUS.RUNNING,
        });

        _setActiveStepsStatusTx(db, missionId, STEP_STATUS.RUNNING);
        const cascadedTaskIds = _resumeMissionCascadedTasksTx(db, missionId);
        return {
            before: _rowToMission(row),
            after: _rowToMission(updatedRow),
            metadata: { cascaded_tasks: cascadedTaskIds },
        };
    })();

    _recordMissionEvents({
        missionId,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: 'MISSION_RESUME',
        before: result.before,
        after: result.after,
        reason,
        metadata: {
            cascaded_tasks_count: result.metadata?.cascaded_tasks?.length || 0,
        },
    });

    return result;
}

/** @typedef {any} CancelMissionCommandOptions */
/**
 * Função exportada: cancelMissionCommand.
 * @param {CancelMissionCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function cancelMissionCommand(/** @type {any} */ { missionId, actor = {}, reason, ifVersion = null }) {
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);
        const rowStatus = String(row.status || '').toUpperCase();
        if (TERMINAL_MISSION.has(rowStatus)) {
            throw _error(409, 'MISSION_TERMINAL', 'Missão já está terminal', { status: row.status });
        }

        const updatedRow = _updateMissionTx(db, row, {
            status: MISSION_STATUS.CANCELLED,
            completed_at_ms: _now(),
        });

        const cascadedTaskIds = _cancelMissionTasksCascadeTx(db, missionId);
        _setActiveStepsStatusTx(db, missionId, STEP_STATUS.CANCELLED);

        return {
            before: _rowToMission(row),
            after: _rowToMission(updatedRow),
            metadata: {
                cascaded_tasks: cascadedTaskIds,
            },
        };
    })();

    _recordMissionEvents({
        missionId,
        actorId: asRecord(actor).id || asRecord(actor).username || null,
        actorType: 'user',
        operation: 'MISSION_CANCEL',
        before: result.before,
        after: result.after,
        reason,
        metadata: {
            cascaded_tasks_count: Array.isArray(result.metadata?.cascaded_tasks)
                ? result.metadata.cascaded_tasks.length
                : 0,
        },
    });

    if (Array.isArray(result.metadata?.cascaded_tasks)) {
        for (const taskId of result.metadata.cascaded_tasks) {
            try {
                recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    actorType: 'user',
                    actorId: asRecord(actor).id || asRecord(actor).username || null,
                    eventType: 'TASK_CANCELLED_BY_MISSION',
                    payload: { mission_id: missionId, reason },
                    dedupKey: `task:${taskId}:cancelled_by_mission:${result.after.updated_at_ms}`,
                });
            } catch (/** @type {any} */ _) {
                // best effort
            }
        }
    }

    return result;
}

/** @typedef {any} PatchMissionCommandOptions */
/**
 * Função exportada: patchMissionCommand.
 * @param {PatchMissionCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function patchMissionCommand(/** @type {any} */ { missionId, actor = {}, reason, ifVersion = null, patch = {} }) {
    const actorView = asRecord(actor);
    const patchView = asRecord(patch);
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);
        const fromStatus = String(row.status || '').toUpperCase();
        if (!EDITABLE_MISSION.has(fromStatus)) {
            throw _error(409, 'MISSION_EDIT_REQUIRES_PAUSED', 'Edição de missão permitida apenas em READY ou PAUSED', {
                status: row.status,
            });
        }

        const updatedRow = _updateMissionTx(db, row, {
            title: patchView.title,
            description: patchView.description,
            autonomy_mode: patchView.autonomy_mode,
        });

        return { before: _rowToMission(row), after: _rowToMission(updatedRow), metadata: {} };
    })();

    _recordMissionEvents({
        missionId,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: 'MISSION_PATCH',
        before: result.before,
        after: result.after,
        reason,
    });

    return result;
}

/** @typedef {any} SetMissionPolicyCommandOptions */
/**
 * Função exportada: setMissionPolicyCommand.
 * @param {SetMissionPolicyCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function setMissionPolicyCommand(/** @type {any} */ {
    missionId,
    actor = {},
    reason,
    ifVersion = null,
    policy = null,
    autonomyMode = null,
}) {
    const actorView = asRecord(actor);
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);

        const fromStatus = String(row.status || '').toUpperCase();
        if (!EDITABLE_MISSION.has(fromStatus)) {
            throw _error(
                409,
                'MISSION_POLICY_REQUIRES_PAUSED',
                'Policy da missão pode ser alterada apenas em READY ou PAUSED',
                {
                    status: row.status,
                }
            );
        }

        const currentPolicy = _safeJsonParse(row.policy_json, {});
        const nextPolicy = policy && typeof policy === 'object' ? { ...currentPolicy, ...policy } : currentPolicy;
        const updatedRow = _updateMissionTx(db, row, {
            policy_json: _safeJsonString(nextPolicy),
            autonomy_mode: autonomyMode || undefined,
        });

        return { before: _rowToMission(row), after: _rowToMission(updatedRow), metadata: {} };
    })();

    _recordMissionEvents({
        missionId,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: 'MISSION_SET_POLICY',
        before: result.before,
        after: result.after,
        reason,
    });

    return result;
}

/** @typedef {any} ReorderMissionStepsCommandOptions */
/**
 * Função exportada: reorderMissionStepsCommand.
 * @param {ReorderMissionStepsCommandOptions} options
 * @returns {Promise<object>|object|null}
 */
function reorderMissionStepsCommand(/** @type {any} */ { missionId, actor = {}, reason, ifVersion = null, stepOrder = [] }) {
    const actorView = asRecord(actor);
    const db = getDb();

    const result = db.transaction(() => {
        const row = _readMissionRowTx(db, missionId);
        _assertIfVersion(row, ifVersion);

        const fromStatus = String(row.status || '').toUpperCase();
        if (!EDITABLE_MISSION.has(fromStatus)) {
            throw _error(409, 'MISSION_REORDER_REQUIRES_PAUSED', 'Reordenação de steps exige missão em READY/PAUSED', {
                status: row.status,
            });
        }

        const context = _safeJsonParse(row.context_json, {});
        const workflow = context?.workflow;
        const currentSteps = Array.isArray(workflow?.steps) ? workflow.steps : [];
        if (currentSteps.length === 0) {
            throw _error(422, 'MISSION_WORKFLOW_MISSING', 'Missão não possui workflow com steps');
        }

        const order = Array.isArray(stepOrder) ? stepOrder.map(id => String(id)) : [];
        const byId = new Map(currentSteps.map((/** @type {any} */ step) => [String(step?.id || ''), step]));
        const reordered = [];

        for (const stepId of order) {
            const item = byId.get(stepId);
            if (item) {
                reordered.push(item);
                byId.delete(stepId);
            }
        }

        for (const item of byId.values()) {
            reordered.push(item);
        }

        context.workflow = {
            ...workflow,
            steps: reordered,
        };

        const updatedRow = _updateMissionTx(db, row, {
            context_json: _safeJsonString(context),
        });

        return {
            before: _rowToMission(row),
            after: _rowToMission(updatedRow),
            metadata: {
                step_order: reordered.map(step => String(step?.id || '')),
            },
        };
    })();

    _syncMissionStepsForMission(result.after);

    _recordMissionEvents({
        missionId,
        actorId: actorView.id || actorView.username || null,
        actorType: 'user',
        operation: 'MISSION_REORDER_STEPS',
        before: result.before,
        after: result.after,
        reason,
        metadata: result.metadata,
    });

    return result;
}

export {
    createMissionCommand,
    MISSION_STATUS,
    cancelMissionCommand,
    executeMissionCommand,
    patchMissionCommand,
    pauseMissionCommand,
    reorderMissionStepsCommand,
    resumeMissionCommand,
    setMissionPolicyCommand,
};
