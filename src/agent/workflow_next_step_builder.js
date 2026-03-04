// @ts-check - Type checking rigoroso habilitado (arquivo core)
import crypto from 'node:crypto';

function _hashId(input) {
    return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex').slice(0, 20);
}

function _ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * @typedef {object} BuildWorkflowNextStepTaskParams
 * @property {Record<string, unknown>} parentTask
 * @property {string} parentTaskId
 */
/**
 * @typedef {object} BuildWorkflowNextStepTaskOptions
 * @property {*} [parentTask]
 * @property {*} [parentTaskId]
 * @property {*} [attemptId]
 * @property {*} [nextStep]
 */
/**
 * Cria task filha determinística para o próximo step de workflow.
 *
 * @param {BuildWorkflowNextStepTaskParams} params
 * @returns {{
 *   childTask: Record<string, unknown>,
 *   childId: string,
 *   nextStepId: string,
 *   nextStepIndex: number,
 *   workflowId: string
 * }}
 */
function buildWorkflowNextStepTask({
    parentTask,
    parentTaskId,
    attemptId = null,
    nextStep = {},
    nextStepIndex = 0,
    workflowConfig = null,
    completedStepIds = [],
    accumulatedContext = {},
    nowMs = Date.now(),
    source = 'self_generated',
}) {
    if (!parentTask || typeof parentTask !== 'object') {
        throw new Error('buildWorkflowNextStepTask requer parentTask');
    }
    if (!parentTaskId) {
        throw new Error('buildWorkflowNextStepTask requer parentTaskId');
    }

    const safeStepIndex = Math.max(0, Number(nextStepIndex) || 0);
    const nextStepId = nextStep?.id ? String(nextStep.id) : `step-${safeStepIndex}`;
    const childId = `task-${_hashId(`${parentTaskId}|${attemptId || 'na'}|${nextStepId}`)}`;

    const rootWorkflowId = parentTask?.meta?.workflow_id || parentTask?.meta?.id || parentTaskId;
    const missionId = parentTask?.meta?.mission_id || parentTask?.mission?.mission_id || null;

    const sys =
        typeof parentTask?.spec?.payload?.system_message === 'string' ? parentTask.spec.payload.system_message : '';
    const prompt =
        (nextStep?.config && typeof nextStep.config === 'object' && typeof nextStep.config.prompt === 'string'
            ? nextStep.config.prompt
            : null) ||
        (typeof nextStep?.description === 'string' ? nextStep.description : null) ||
        (typeof nextStep?.name === 'string' ? nextStep.name : null) ||
        `Execute workflow step ${safeStepIndex + 1}`;

    const completed = _ensureArray(completedStepIds);
    const inputs = completed.map(stepId => ({
        type: 'task_result',
        task_id: accumulatedContext?.[stepId]?.task_id || parentTaskId,
        attempt: 'latest',
        format: 'text',
        label: `workflow_step_output:${String(stepId)}`,
    }));

    const existingTags = _ensureArray(parentTask?.meta?.tags).map(tag => String(tag));
    const tags = Array.from(new Set([...existingTags, 'workflow_step']));

    const childTask = {
        ...parentTask,
        meta: {
            ...(parentTask.meta || {}),
            id: childId,
            parent_id: parentTaskId,
            workflow_id: rootWorkflowId,
            mission_id: missionId || undefined,
            created_at: new Date(nowMs).toISOString(),
            source: String(source || 'self_generated'),
            tags,
        },
        spec: {
            ...(parentTask.spec || {}),
            payload: {
                system_message: sys,
                user_message: String(prompt),
                context: {
                    ...(parentTask?.spec?.payload?.context && typeof parentTask.spec.payload.context === 'object'
                        ? parentTask.spec.payload.context
                        : {}),
                    inputs,
                    workflow_step_id: nextStepId,
                    workflow_step_index: safeStepIndex,
                },
            },
            execution: {
                ...(parentTask?.spec?.execution || {}),
                strategy: 'MULTI_STEP',
                workflow_config: workflowConfig || parentTask?.spec?.execution?.workflow_config || null,
            },
        },
        policy: {
            ...(parentTask.policy || {}),
            dependencies: [parentTaskId],
            execute_after: null,
        },
        mission: {
            ...(parentTask.mission || {}),
            mission_id: missionId,
            step_id: nextStepId,
            step_index: safeStepIndex,
        },
        state: {
            ...(parentTask.state || {}),
            status: 'PENDING',
            workflow_state: parentTask?.state?.workflow_state,
        },
        result: {},
    };

    return {
        childTask,
        childId,
        nextStepId,
        nextStepIndex: safeStepIndex,
        workflowId: rootWorkflowId,
    };
}

export { buildWorkflowNextStepTask };
