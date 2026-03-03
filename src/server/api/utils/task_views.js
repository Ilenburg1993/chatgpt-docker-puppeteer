// @ts-check
import { log } from '#core/logger';

/**
 * @typedef {object} TaskViewRow
 * @property {string} [id]
 * @property {string} [mission_id]
 * @property {string} [mission_title]
 * @property {string} [mission_status]
 * @property {string} [mission_autonomy_mode]
 * @property {string} [workflow_id]
 * @property {string} [parent_id]
 * @property {string} [status]
 * @property {string} [stage]
 * @property {number} [attempts]
 * @property {number} [priority]
 * @property {string} [target]
 * @property {string} [model]
 * @property {number} [execute_after_ms]
 * @property {string} [locked_by]
 * @property {number} [lock_expires_at_ms]
 * @property {string} [blocked_reason]
 * @property {number} [blocked_at_ms]
 * @property {string} [latest_attempt_id]
 * @property {string} [spec_user_message]
 * @property {string} [spec_system_message]
 * @property {number} [created_at_ms]
 * @property {number} [updated_at_ms]
 * @property {number} [started_at_ms]
 * @property {number} [completed_at_ms]
 * @property {number} [failed_at_ms]
 * @property {number} [paused_at_ms]
 * @property {number} [cancelled_at_ms]
 * @property {string} [task_json]
 * @property {string} [prompt_template_artifact_id]
 * @property {string} [last_error]
 * @property {string} [blocked_details_json]
 */

/**
 * @typedef {object} TaskCommandCaps
 * @property {boolean} can_pause
 * @property {boolean} can_resume
 * @property {boolean} can_unblock
 * @property {boolean} can_retry
 * @property {boolean} can_cancel
 * @property {boolean} can_patch
 * @property {boolean} can_set_dependencies
 * @property {boolean} can_reassign_mission
 */

/**
 * @typedef {Record<string, unknown> & {
 *   meta?: Record<string, unknown>,
 *   state?: Record<string, unknown>,
 *   spec?: Record<string, unknown>
 * }} TaskJsonShape
 */

function _preview(text, maxChars) {
    const s = typeof text === 'string' ? text : String(text ?? '');
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

/**
 * Faz parse seguro do `task_json` persistido em banco.
 * @param {unknown} raw
 * @returns {TaskJsonShape|null}
 */
function parseTaskJson(raw) {
    try {
        return raw ? JSON.parse(String(raw)) : null;
    } catch (_) {
        return null;
    }
}

function getOrchestrationSummary(taskJson, row) {
    const strategy = taskJson?.spec?.execution?.strategy || 'SINGLE_SHOT';

    const iteration = Number(taskJson?.state?.iteration_state?.current_iteration || 0) || 0;
    const workflowStepIndex = Number(taskJson?.state?.workflow_state?.current_step_index || 0) || 0;

    return {
        strategy,
        iteration,
        workflow_step_index: workflowStepIndex,
        workflow_id: row?.workflow_id ?? taskJson?.meta?.workflow_id ?? null,
        parent_id: row?.parent_id ?? taskJson?.meta?.parent_id ?? null,
    };
}

function _isEditable(row) {
    const status = String(row?.status || '').toUpperCase();
    const stage = String(row?.stage || '').toUpperCase();
    const attempts = Number(row?.attempts || 0);
    const startedAt = row?.started_at_ms ?? null;
    return status === 'PAUSED' || (status === 'PENDING' && stage === 'READY' && attempts === 0 && !startedAt);
}

/**
 * Constrói as capacidades de mutação disponíveis para uma task.
 * @param {TaskViewRow} row
 * @returns {TaskCommandCaps}
 */
function buildTaskCommandCaps(row) {
    const status = String(row?.status || '').toUpperCase();
    const editable = _isEditable(row);
    return {
        can_pause: ['PENDING', 'RUNNING'].includes(status),
        can_resume: ['PAUSED', 'BLOCKED'].includes(status),
        can_unblock: status === 'BLOCKED',
        can_retry: ['FAILED', 'DONE', 'CANCELLED', 'PAUSED', 'BLOCKED'].includes(status),
        can_cancel: ['PENDING', 'PAUSED', 'RUNNING', 'BLOCKED'].includes(status),
        can_patch: editable,
        can_set_dependencies: editable,
        can_reassign_mission: editable,
    };
}

function buildMissionRef(row) {
    if (!row?.mission_id) return null;
    return {
        id: row.mission_id,
        title: row.mission_title || null,
        status: row.mission_status || null,
        autonomy_mode: row.mission_autonomy_mode || null,
    };
}

/**
 * Projeta uma task persistida para o formato de listagem.
 * @param {TaskViewRow} row
 * @returns {TaskJsonShape}
 */
function taskRowToListItem(row) {
    const taskJson = parseTaskJson(row.task_json);
    const orchestration = getOrchestrationSummary(taskJson, row);
    const missionRef = buildMissionRef(row);

    return {
        id: row.id,
        mission_id: row.mission_id ?? null,
        mission_ref: missionRef,
        stage: row.stage,
        status: row.status,
        unified_status: row.status,
        priority: row.priority,
        target: row.target,
        model: row.model ?? null,
        execute_after_ms: row.execute_after_ms ?? null,
        attempts: row.attempts ?? 0,
        locked_by: row.locked_by ?? null,
        lock_expires_at_ms: row.lock_expires_at_ms ?? null,
        blocked_reason: row.blocked_reason ?? null,
        blocked_at_ms: row.blocked_at_ms ?? null,
        latest_attempt_id: row.latest_attempt_id ?? null,
        parent_id: row.parent_id ?? null,
        workflow_id: row.workflow_id ?? null,
        spec_user_message_preview: _preview(row.spec_user_message, 300),
        spec_system_message_preview: _preview(row.spec_system_message, 120),
        orchestration_summary: orchestration,
        command_caps: buildTaskCommandCaps(row),
        timestamps: {
            created_at_ms: row.created_at_ms,
            updated_at_ms: row.updated_at_ms,
            started_at_ms: row.started_at_ms ?? null,
            completed_at_ms: row.completed_at_ms ?? null,
            failed_at_ms: row.failed_at_ms ?? null,
            paused_at_ms: row.paused_at_ms ?? null,
            cancelled_at_ms: row.cancelled_at_ms ?? null,
        },
    };
}

/**
 * Projeta uma task persistida para o formato detalhado consumido pela UI.
 * @param {TaskViewRow} row
 * @returns {TaskJsonShape}
 */
function taskRowToDetailTask(row) {
    const task = parseTaskJson(row.task_json) || {};
    task.stage = row.stage;
    task.unified_status = row.status;
    task.latest_attempt_id = row.latest_attempt_id ?? null;
    task.prompt_template_artifact_id = row.prompt_template_artifact_id ?? null;

    task.meta =
        task.meta && typeof task.meta === 'object' ? /** @type {Record<string, unknown>} */ (task.meta) : {};
    const taskMeta = /** @type {Record<string, unknown>} */ (task.meta);
    if (row.parent_id) taskMeta.parent_id = row.parent_id;
    if (row.workflow_id) taskMeta.workflow_id = row.workflow_id;

    task.state =
        task.state && typeof task.state === 'object' ? /** @type {Record<string, unknown>} */ (task.state) : {};
    const taskState = /** @type {Record<string, unknown>} */ (task.state);
    taskState.status = row.status;

    // Expose DB columns that are not stored inside task_json so the UI
    // can show actionable information for BLOCKED/FAILED tasks.
    /** @type {string|null} Reason code set when task was blocked (e.g. 'ENV_UNAVAILABLE_LONG'). */
    task.blocked_reason = row.blocked_reason ?? null;
    /** @type {number|null} Timestamp (ms) when task was blocked. */
    task.blocked_at_ms = row.blocked_at_ms ?? null;
    /** @type {string|null} Last error text from most recent failed attempt. */
    task.last_error = row.last_error ?? null;
    /** @type {Record<string, unknown>|string|null} Parsed blocked_details_json, or raw string if invalid JSON. */
    task.blocked_details = null;
    if (row.blocked_details_json) {
        try {
            task.blocked_details = JSON.parse(String(row.blocked_details_json));
        } catch (_) {
            log(
                'WARN',
                `[task_views] malformed JSON in blocked_details_json for task ${row.id} — using raw string fallback`
            );
            task.blocked_details = row.blocked_details_json;
        }
    }

    task.command_caps = buildTaskCommandCaps(row);
    task.mission_ref = buildMissionRef(row);

    return task;
}

export { buildTaskCommandCaps, parseTaskJson, taskRowToListItem, taskRowToDetailTask };
