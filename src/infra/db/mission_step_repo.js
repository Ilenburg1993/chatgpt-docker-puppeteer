// @ts-check
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './sqlite.js';

/** Constante/valor exportado: STEP_STATUS. */
const STEP_STATUS = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
});

function _now() {
    return Date.now();
}

function _rowToStep(row) {
    if (!row) return null;
    return {
        id: String(row.id),
        mission_id: String(row.mission_id),
        step_id: String(row.step_id),
        step_index: Number(row.step_index) || 0,
        title: String(row.title || ''),
        status: String(row.status || STEP_STATUS.PENDING),
        current_task_id: row.current_task_id ? String(row.current_task_id) : null,
        last_task_id: row.last_task_id ? String(row.last_task_id) : null,
        attempt_seq: Number(row.attempt_seq) || 0,
        version: Number(row.version) || 1,
        updated_at_ms: Number(row.updated_at_ms) || 0,
    };
}

/**
 * Função exportada: listMissionSteps.
 * @returns {MissionStep[]}
 */
function listMissionSteps(missionId) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT *
            FROM mission_steps
            WHERE mission_id = ?
            ORDER BY step_index ASC, attempt_seq DESC
        `
        )
        .all(String(missionId || '').trim());

    return rows.map(_rowToStep).filter(Boolean);
}

/**
 * Função exportada: getMissionStep.
 * @returns {MissionStep|null}
 */
function getMissionStep(missionId, stepId, attemptSeq = null) {
    const db = getDb();
    const mission = String(missionId || '').trim();
    const step = String(stepId || '').trim();
    if (!mission || !step) return null;

    const row =
        attemptSeq === null
            ? db
                  .prepare(
                      `
                SELECT *
                FROM mission_steps
                WHERE mission_id = ? AND step_id = ?
                ORDER BY attempt_seq DESC
                LIMIT 1
            `
                  )
                  .get(mission, step)
            : db
                  .prepare(
                      `
                SELECT *
                FROM mission_steps
                WHERE mission_id = ? AND step_id = ? AND attempt_seq = ?
                LIMIT 1
            `
                  )
                  .get(mission, step, Number(attemptSeq) || 0);

    return _rowToStep(row);
}

/**
 * Função exportada: syncMissionStepsFromWorkflow.
 * @returns {MissionStep|null}
 */
function syncMissionStepsFromWorkflow(missionId, workflow) {
    const db = getDb();
    const mission = String(missionId || '').trim();
    if (!mission) return [];

    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
    if (steps.length === 0) return listMissionSteps(mission);

    const now = _now();
    const tx = db.transaction(() => {
        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index] || {};
            const stepId = String(step.id || `step-${index}`);
            const title = String(step.title || step.name || step.description || `Step ${index + 1}`);

            const existing = db
                .prepare(
                    `
                    SELECT *
                    FROM mission_steps
                    WHERE mission_id = ? AND step_id = ?
                    ORDER BY attempt_seq DESC
                    LIMIT 1
                `
                )
                .get(mission, stepId);

            if (!existing) {
                db.prepare(
                    `
                    INSERT INTO mission_steps (
                        id, mission_id, step_id, step_index, title, status,
                        current_task_id, last_task_id, attempt_seq, version, updated_at_ms
                    ) VALUES (
                        @id, @mission_id, @step_id, @step_index, @title, @status,
                        NULL, NULL, @attempt_seq, 1, @updated_at_ms
                    )
                `
                ).run({
                    id: `ms-${uuidv4()}`,
                    mission_id: mission,
                    step_id: stepId,
                    step_index: index,
                    title,
                    status: STEP_STATUS.PENDING,
                    attempt_seq: 1,
                    updated_at_ms: now,
                });
                continue;
            }

            db.prepare(
                `
                UPDATE mission_steps
                SET step_index = @step_index,
                    title = @title,
                    updated_at_ms = @updated_at_ms
                WHERE id = @id
            `
            ).run({
                id: existing.id,
                step_index: index,
                title,
                updated_at_ms: now,
            });
        }
    });

    tx();
    return listMissionSteps(mission);
}

/**
 * Função exportada: markMissionStepStatus.
 * @returns {MissionStep|null}
 */
function markMissionStepStatus({
    missionId,
    stepId,
    attemptSeq = null,
    status,
    currentTaskId = undefined,
    lastTaskId = undefined,
}) {
    const db = getDb();
    const mission = String(missionId || '').trim();
    const step = String(stepId || '').trim();
    const nextStatus = String(status || STEP_STATUS.PENDING).toUpperCase();
    if (!mission || !step) return null;

    const existing = getMissionStep(mission, step, attemptSeq);
    if (!existing) return null;

    const now = _now();
    db.prepare(
        `
        UPDATE mission_steps
        SET status = @status,
            current_task_id = @current_task_id,
            last_task_id = @last_task_id,
            version = version + 1,
            updated_at_ms = @updated_at_ms
        WHERE id = @id
    `
    ).run({
        id: existing.id,
        status: nextStatus,
        current_task_id: currentTaskId === undefined ? existing.current_task_id : currentTaskId,
        last_task_id: lastTaskId === undefined ? existing.last_task_id : lastTaskId,
        updated_at_ms: now,
    });

    return getMissionStep(mission, step, existing.attempt_seq);
}

/**
 * Função exportada: createNextStepAttempt.
 * @returns {MissionStep|null}
 */
function createNextStepAttempt({ missionId, stepId, title = '', stepIndex = 0 }) {
    const db = getDb();
    const mission = String(missionId || '').trim();
    const step = String(stepId || '').trim();
    if (!mission || !step) return null;

    const latest = getMissionStep(mission, step, null);
    const nextAttempt = Math.max(1, Number(latest?.attempt_seq || 0) + 1);
    const now = _now();

    db.prepare(
        `
        INSERT INTO mission_steps (
            id, mission_id, step_id, step_index, title, status,
            current_task_id, last_task_id, attempt_seq, version, updated_at_ms
        ) VALUES (
            @id, @mission_id, @step_id, @step_index, @title, @status,
            NULL, @last_task_id, @attempt_seq, 1, @updated_at_ms
        )
    `
    ).run({
        id: `ms-${uuidv4()}`,
        mission_id: mission,
        step_id: step,
        step_index: Number(stepIndex) || 0,
        title: String(title || step),
        status: STEP_STATUS.PENDING,
        last_task_id: latest?.current_task_id || latest?.last_task_id || null,
        attempt_seq: nextAttempt,
        updated_at_ms: now,
    });

    return getMissionStep(mission, step, nextAttempt);
}

export {
    STEP_STATUS,
    createNextStepAttempt,
    getMissionStep,
    listMissionSteps,
    markMissionStepStatus,
    syncMissionStepsFromWorkflow,
};
