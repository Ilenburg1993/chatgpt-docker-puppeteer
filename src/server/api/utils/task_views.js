// @ts-check

function _preview(text, maxChars) {
    const s = typeof text === 'string' ? text : String(text ?? '');
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars);
}

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

function taskRowToDetailTask(row) {
    const task = parseTaskJson(row.task_json) || {};
    task.stage = row.stage;
    task.unified_status = row.status;
    task.latest_attempt_id = row.latest_attempt_id ?? null;
    task.prompt_template_artifact_id = row.prompt_template_artifact_id ?? null;

    task.meta = task.meta || {};
    if (row.parent_id) task.meta.parent_id = row.parent_id;
    if (row.workflow_id) task.meta.workflow_id = row.workflow_id;

    task.state = task.state || {};
    task.state.status = row.status;
    task.command_caps = buildTaskCommandCaps(row);
    task.mission_ref = buildMissionRef(row);

    return task;
}

export { buildTaskCommandCaps, parseTaskJson, taskRowToListItem, taskRowToDetailTask };
