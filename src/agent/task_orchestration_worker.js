// @ts-check - Type checking rigoroso habilitado (arquivo core)
import crypto from 'node:crypto';
import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';
import { recordEvent } from '#infra/db/events_repo';
import { getAttemptById } from '#infra/db/task_attempt_repo';
import { insertArtifact } from '#infra/db/artifact_repo';
import { insertTask, releaseTaskLock, TASK_STAGES, updateTask } from '#infra/db/task_repo';
import { readText, putText } from '#infra/storage/artifact_store';
import { ValidationService } from '#orchestrator/validation/validation_service';
import fs from 'node:fs/promises';

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function _safeJsonString(value) {
    try {
        return JSON.stringify(value ?? null);
    } catch (_) {
        return JSON.stringify({ error: 'json_stringify_failed' });
    }
}

function _now() {
    return Date.now();
}

function _truncate(text, maxLen) {
    const s = typeof text === 'string' ? text : String(text ?? '');
    if (!maxLen || maxLen <= 0) return '';
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function _computeBackoffMs({ iteration = 1, minMs = 2000, maxMs = 120000 } = {}) {
    const it = Math.max(1, Number(iteration) || 1);
    const base = Math.min(maxMs, minMs * Math.pow(2, Math.max(0, it - 1)));
    const jitter = Math.floor(base * (0.1 + Math.random() * 0.1)); // 10–20%
    return Math.min(maxMs, base + jitter);
}

function _hashId(input) {
    return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex').slice(0, 20);
}

async function _readAttemptOutputText({ taskId, attemptId, resultJson } = {}) {
    if (!taskId || !attemptId) return '';

    const attempt = getAttemptById(attemptId);

    // 1) response_v2_json artifact
    const v2Id = attempt?.response_v2_json_artifact_id || null;
    if (v2Id) {
        try {
            const raw = await readText(v2Id);
            if (raw) {
                const parsed = JSON.parse(raw);
                const text =
                    parsed?.content?.text ||
                    parsed?.output ||
                    parsed?.result?.output ||
                    parsed?.result?.raw_output_preview ||
                    '';
                if (typeof text === 'string' && text.trim()) {
                    return text;
                }
            }
        } catch (_) {
            /* ignore */
        }
    }

    // 2) response_text artifact
    const textId = attempt?.response_text_artifact_id || null;
    if (textId) {
        try {
            const raw = await readText(textId);
            if (typeof raw === 'string' && raw.trim()) return raw;
        } catch (_) {
            /* ignore */
        }
    }

    // 3) Legacy fallback: tasks.result_json.storage.text_file
    let parsed = null;
    try {
        parsed = resultJson ? JSON.parse(String(resultJson)) : null;
    } catch (_) {
        parsed = null;
    }
    const p = parsed?.storage?.text_file || parsed?.storage?.textFile || null;
    if (p) {
        try {
            const raw = await fs.readFile(String(p), 'utf8');
            if (typeof raw === 'string' && raw.trim()) return raw;
        } catch (_) {
            /* ignore */
        }
    }

    return '';
}

function _ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function _setOrReplaceInput({ inputs, next } = {}) {
    const list = _ensureArray(inputs).filter(Boolean);
    if (!next || typeof next !== 'object') return list;

    const type = next.type ? String(next.type) : '';
    const label = next.label ? String(next.label) : '';

    const filtered = list.filter(item => {
        if (!item || typeof item !== 'object') return false;
        if (type && String(item.type || '') !== type) return true;
        if (label && String(item.label || '') !== label) return true;
        return false;
    });

    filtered.push(next);
    return filtered;
}

function _workflowStateFromTask(task) {
    const ws = task?.state?.workflow_state;
    if (!ws || typeof ws !== 'object') {
        return {
            current_step_index: 0,
            completed_steps: [],
            failed_steps: [],
            accumulated_context: {},
        };
    }
    return {
        current_step_index: Number(ws.current_step_index || 0) || 0,
        completed_steps: _ensureArray(ws.completed_steps).map(String),
        failed_steps: _ensureArray(ws.failed_steps).map(String),
        accumulated_context: ws.accumulated_context && typeof ws.accumulated_context === 'object' ? ws.accumulated_context : {},
    };
}

class TaskOrchestrationWorker {
    constructor({
        browserPool = null,
        workerId = null,
        intervalMs = 1250,
        batchSize = 50,
        pausedRescheduleDelayMs = 30000,
        outputMissingEscalation = { windowMs: 10 * 60 * 1000, threshold: 3 },
    } = {}) {
        this.browserPool = browserPool || null;
        this.workerId = workerId ? String(workerId) : `orch-${process.pid}`;
        this.intervalMs = Math.max(250, Number(intervalMs) || 1250);
        this.batchSize = Math.max(1, Math.min(Number(batchSize) || 50, 500));
        this.pausedRescheduleDelayMs = Math.max(1000, Number(pausedRescheduleDelayMs) || 30000);
        this.outputMissingEscalation = outputMissingEscalation || { windowMs: 600000, threshold: 3 };

        this._timer = null;
        this._running = false;
        this._stopped = false;

        // Deterministic validation (no NERV side effects).
        this.validationService = new ValidationService({ nerv: null });
    }

    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[TaskOrchestrationWorker] started (interval=${this.intervalMs}ms, batch=${this.batchSize})`);
    }

    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[TaskOrchestrationWorker] stopped');
    }

    _shouldPauseDispatch() {
        return Boolean(this.browserPool?.circuitBreaker?.shouldPauseSystem?.());
    }

    _hasAppliedOrchestration({ taskId, attemptId } = {}) {
        const db = getDb();
        const dedupKey = `task:${taskId}:orchestrated:${attemptId}`;
        return Boolean(
            db.prepare('SELECT 1 AS ok FROM events WHERE dedup_key = ? LIMIT 1').get(dedupKey)?.ok
        );
    }

    _claimOrchestrationLock({ taskId, nowMs, lockTtlMs = 120000 } = {}) {
        const db = getDb();
        const now = Number(nowMs) || _now();
        const expires = now + Math.max(5000, Number(lockTtlMs) || 120000);

        const res = db
            .prepare(
                `
                UPDATE tasks
                SET locked_by = @workerId,
                    locked_at_ms = @now,
                    lock_expires_at_ms = @expires,
                    updated_at_ms = @now
                WHERE id = @id
                  AND (locked_by IS NULL OR lock_expires_at_ms IS NULL OR lock_expires_at_ms <= @now)
            `
            )
            .run({ id: taskId, workerId: this.workerId, now, expires });

        return Boolean(res.changes);
    }

    async tick() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const db = getDb();

            const rows = db
                .prepare(
                    `
                    SELECT
                        t.id, t.mission_id, t.task_json, t.result_json, t.latest_attempt_id, t.updated_at_ms
                    FROM tasks t
                    LEFT JOIN missions m ON m.id = t.mission_id
                    WHERE t.stage = 'ARCHIVED'
                      AND t.status = 'DONE'
                      AND t.locked_by IS NULL
                      AND json_extract(t.task_json, '$.spec.execution.strategy') IN ('ITERATIVE','MULTI_STEP')
                      AND (t.mission_id IS NULL OR m.status = 'RUNNING')
                    ORDER BY t.updated_at_ms ASC
                    LIMIT ?
                `
                )
                .all(this.batchSize);

            for (const row of rows) {
                const taskId = row?.id;
                const attemptId = row?.latest_attempt_id;
                if (!taskId || !attemptId) continue;

                if (this._hasAppliedOrchestration({ taskId, attemptId })) {
                    continue;
                }

                const now = _now();
                if (!this._claimOrchestrationLock({ taskId, nowMs: now })) {
                    continue;
                }

                try {
                    const result = await this._processTaskRow(row);
                    if (result?.finalized) {
                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: _now(),
                            actorType: 'system',
                            eventType: 'TASK_ORCHESTRATION_APPLIED',
                            payload: { taskId, attemptId },
                            dedupKey: `task:${taskId}:orchestrated:${attemptId}`,
                        });
                    }
                } catch (err) {
                    log('WARN', `[TaskOrchestrationWorker] task ${taskId} orchestration failed: ${err?.message || String(err)}`);
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: _now(),
                        actorType: 'system',
                        eventType: 'TASK_ORCHESTRATION_ERROR',
                        payload: { taskId, attemptId, error: err?.message || String(err) },
                        dedupKey: `task:${taskId}:orchestration_error:${attemptId}`,
                    });
                } finally {
                    releaseTaskLock({ taskId, workerId: this.workerId });
                }

                await _sleep(0);
            }
        } finally {
            this._running = false;
        }
    }

    async _processTaskRow(row) {
        const taskId = row.id;
        const attemptId = row.latest_attempt_id;

        let task = null;
        try {
            task = row.task_json ? JSON.parse(String(row.task_json)) : null;
        } catch (_) {
            task = null;
        }
        if (!task || typeof task !== 'object') return { finalized: true };

        const strategy = task?.spec?.execution?.strategy || null;
        if (strategy !== 'ITERATIVE' && strategy !== 'MULTI_STEP') {
            // Safety: block unknown strategy.
            updateTask(taskId, {
                status: 'BLOCKED',
                blocked_reason: 'ORCH_STRATEGY_UNKNOWN',
                blocked_at_ms: _now(),
                blocked_details_json: _safeJsonString({ attemptId, strategy }),
            });
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: _now(),
                actorType: 'system',
                eventType: 'TASK_BLOCKED_ORCH_UNKNOWN_STRATEGY',
                payload: { attemptId, strategy },
                dedupKey: `task:${taskId}:blocked_unknown_strategy:${attemptId}`,
            });
            return { finalized: true };
        }

        const outputText = await _readAttemptOutputText({
            taskId,
            attemptId,
            resultJson: row.result_json,
        });

        if (!outputText || !outputText.trim()) {
            const blocked = await this._handleMissingOutput({ taskId, attemptId });
            return { finalized: Boolean(blocked) };
        }

        if (strategy === 'ITERATIVE') {
            await this._handleIterative({ taskId, attemptId, task, outputText });
            return { finalized: true };
        }

        await this._handleMultiStep({ taskId, attemptId, task, outputText });
        return { finalized: true };
    }

    async _handleMissingOutput({ taskId, attemptId } = {}) {
        const db = getDb();
        const now = _now();

        recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: now,
            actorType: 'system',
            eventType: 'TASK_ORCHESTRATION_OUTPUT_MISSING',
            payload: { attemptId },
            dedupKey: `task:${taskId}:orch_output_missing:${attemptId}`,
        });

        const windowMs = Math.max(60000, Number(this.outputMissingEscalation?.windowMs || 600000) || 600000);
        const threshold = Math.max(1, Number(this.outputMissingEscalation?.threshold || 3) || 3);

        const recent = db
            .prepare(
                `
                SELECT COUNT(1) AS c
                FROM events
                WHERE entity_type = 'task'
                  AND entity_id = ?
                  AND event_type = 'TASK_ORCHESTRATION_OUTPUT_MISSING'
                  AND ts_ms >= ?
            `
            )
            .get(taskId, now - windowMs)?.c || 0;

        if (Number(recent || 0) < threshold) {
            // First occurrences: keep it as-is; next tick may succeed once artifacts are persisted.
            return false;
        }

        updateTask(taskId, {
            status: 'BLOCKED',
            blocked_reason: 'ORCH_OUTPUT_MISSING',
            blocked_at_ms: now,
            blocked_details_json: _safeJsonString({ attemptId, recent, windowMs }),
        });

        recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: now,
            actorType: 'system',
            eventType: 'TASK_BLOCKED_ORCH_OUTPUT_MISSING',
            payload: { attemptId, recent, windowMs },
            dedupKey: `task:${taskId}:blocked_output_missing:${attemptId}`,
        });

        return true;
    }

    async _handleIterative({ taskId, attemptId, task, outputText } = {}) {
        const now = _now();
        const cfg = task?.spec?.execution?.iterative_config || {};
        const maxIterations = Math.max(1, Number(cfg?.max_iterations ?? 3) || 3);

        const existingState = task.state && typeof task.state === 'object' ? task.state : {};
        const iter = existingState.iteration_state && typeof existingState.iteration_state === 'object' ? existingState.iteration_state : {};
        const currentIteration = Math.max(0, Number(iter.current_iteration || 0) || 0);
        const nextIteration = currentIteration + 1;

        const validators = _ensureArray(task?.spec?.validation?.validators);
        const criteriaRaw = cfg?.validation_criteria || task?.spec?.execution?.iterative_config?.validation_criteria || {};
        const criteria = criteriaRaw && typeof criteriaRaw === 'object' ? criteriaRaw : {};

        const validationResult = await this.validationService.validate(String(outputText), {
            validators,
            criteria,
        });

        const history = _ensureArray(iter.iterations_history).slice(0, 500);
        history.push({
            iteration: nextIteration,
            output: _truncate(outputText, 2000),
            output_length: String(outputText).length,
            quality_score: validationResult.overall_score,
            validation_result: {
                passed: validationResult.passed,
                overall_score: validationResult.overall_score,
                issues: _ensureArray(validationResult.issues).slice(0, 50),
            },
        });

        task.state = task.state || {};
        task.state.iteration_state = {
            current_iteration: nextIteration,
            iterations_history: history,
        };
        task.state.quality_metrics = {
            overall_score: validationResult.overall_score,
            validation_passed: Boolean(validationResult.passed),
        };

        // Always persist state updates (even when no retry is needed).
        updateTask(taskId, { task });

        if (validationResult.passed) {
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_ORCHESTRATION_DONE',
                payload: { attemptId, iteration: nextIteration, overall_score: validationResult.overall_score },
                dedupKey: `task:${taskId}:orch_done:${attemptId}`,
            });
            return;
        }

        const onFailure = task?.spec?.validation?.on_validation_failure || 'retry';
        if (onFailure === 'manual_review') {
            const feedbackArtifactId = await this._persistFeedbackArtifact({
                taskId,
                attemptId,
                validationResult,
                outputPreview: _truncate(outputText, 2000),
            });

            updateTask(taskId, {
                status: 'BLOCKED',
                blocked_reason: 'VALIDATION_MANUAL_REVIEW',
                blocked_at_ms: now,
                blocked_details_json: _safeJsonString({
                    attemptId,
                    iteration: nextIteration,
                    overall_score: validationResult.overall_score,
                    issues: _ensureArray(validationResult.issues).slice(0, 50),
                    feedback_artifact_id: feedbackArtifactId,
                }),
            });

            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_BLOCKED_BY_VALIDATION',
                payload: { attemptId, iteration: nextIteration, feedback_artifact_id: feedbackArtifactId },
                dedupKey: `task:${taskId}:blocked_by_validation:${attemptId}`,
            });
            return;
        }

        if (nextIteration >= maxIterations) {
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_ORCHESTRATION_MAX_ITERATIONS_REACHED',
                payload: { attemptId, iteration: nextIteration, maxIterations },
                dedupKey: `task:${taskId}:orch_max_iterations:${attemptId}`,
            });
            return;
        }

        const feedbackArtifactId = await this._persistFeedbackArtifact({
            taskId,
            attemptId,
            validationResult,
            outputPreview: _truncate(outputText, 2000),
        });

        // Add/replace orchestration_feedback input for the next run.
        task.spec = task.spec || {};
        task.spec.payload = task.spec.payload || {};
        task.spec.payload.context = task.spec.payload.context && typeof task.spec.payload.context === 'object' ? task.spec.payload.context : {};

        const prevInputs = _ensureArray(task.spec.payload.context.inputs);
        task.spec.payload.context.inputs = _setOrReplaceInput({
            inputs: prevInputs,
            next: {
                type: 'artifact_text',
                artifact_id: feedbackArtifactId,
                label: 'orchestration_feedback',
            },
        });

        const baseDelay = _computeBackoffMs({ iteration: nextIteration, minMs: 2000, maxMs: 120000 });
        const delayMs = this._shouldPauseDispatch() ? Math.max(baseDelay, this.pausedRescheduleDelayMs) : baseDelay;
        const executeAfterMs = now + delayMs;

        // Rearm the SAME taskId for SSOT dispatch (new attempt will be created).
        updateTask(taskId, {
            task,
            stage: TASK_STAGES.READY,
            status: 'PENDING',
            execute_after_ms: executeAfterMs,
            last_error: `ORCHESTRATION_RETRY_SCHEDULED(iter=${nextIteration}, score=${Number(validationResult.overall_score || 0).toFixed(1)})`.slice(0, 2000),
            started_at_ms: null,
            completed_at_ms: null,
            failed_at_ms: null,
            paused_at_ms: null,
            cancelled_at_ms: null,
            blocked_reason: null,
            blocked_at_ms: null,
            blocked_details_json: null,
            last_correlation_id: null,
            latest_attempt_id: null,
            latest_rendered_prompt_artifact_id: null,
            latest_response_v2_json_artifact_id: null,
            result_json: null,
        });

        recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: now,
            actorType: 'system',
            eventType: 'TASK_ORCHESTRATION_RETRY_SCHEDULED',
            payload: {
                from_attempt_id: attemptId,
                iteration: nextIteration,
                next_execute_after_ms: executeAfterMs,
                feedback_artifact_id: feedbackArtifactId,
            },
            dedupKey: `task:${taskId}:orch_retry_scheduled:${attemptId}:${nextIteration}`,
        });
    }

    async _persistFeedbackArtifact({ taskId, attemptId, validationResult, outputPreview } = {}) {
        const now = _now();
        const issues = _ensureArray(validationResult?.issues).slice(0, 50);
        const score = Number(validationResult?.overall_score ?? 0) || 0;

        const feedbackText = [
            `[Orchestration Feedback]`,
            `task_id=${taskId}`,
            `attempt_id=${attemptId}`,
            `overall_score=${score.toFixed(1)}`,
            ``,
            `Issues:`,
            ...issues.map(i => `- ${i}`),
            ``,
            `Output preview (first 2000 chars):`,
            outputPreview || '',
            ``,
            `Please improve the response addressing the issues above.`,
            ``,
        ].join('\n');

        const stored = await putText({
            kind: 'orchestration_feedback',
            text: feedbackText,
            relPath: `orchestration/feedback/${taskId}/${attemptId}-${now}.txt`,
            ext: 'txt',
            mime: 'text/plain',
        });

        const artId = insertArtifact({
            kind: 'orchestration_feedback',
            mime: stored.mime,
            size_bytes: stored.sizeBytes,
            sha256: stored.sha256,
            storage_uri: stored.storageUri,
            created_by: 'system',
            created_at_ms: now,
        });

        return artId;
    }

    async _handleMultiStep({ taskId, attemptId, task, outputText } = {}) {
        const now = _now();
        const wf = task?.spec?.execution?.workflow_config || null;
        const steps = _ensureArray(wf?.steps);
        if (!steps.length) {
            updateTask(taskId, {
                status: 'BLOCKED',
                blocked_reason: 'WORKFLOW_CONFIG_MISSING',
                blocked_at_ms: now,
                blocked_details_json: _safeJsonString({ attemptId }),
            });
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_BLOCKED_WORKFLOW_CONFIG_MISSING',
                payload: { attemptId },
                dedupKey: `task:${taskId}:blocked_workflow_missing:${attemptId}`,
            });
            return;
        }

        const state = _workflowStateFromTask(task);
        const currentIndex = Math.max(0, Number(state.current_step_index || 0) || 0);
        const currentStep = steps[currentIndex] || null;
        const currentStepId = currentStep?.id ? String(currentStep.id) : `step-${currentIndex}`;

        // Only execute_prompt is supported for now.
        const action = currentStep?.action ? String(currentStep.action) : 'execute_prompt';
        if (action !== 'execute_prompt') {
            updateTask(taskId, {
                status: 'BLOCKED',
                blocked_reason: 'WORKFLOW_ACTION_UNSUPPORTED',
                blocked_at_ms: now,
                blocked_details_json: _safeJsonString({ attemptId, step_id: currentStepId, action }),
            });
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_BLOCKED_WORKFLOW_UNSUPPORTED',
                payload: { attemptId, step_id: currentStepId, action },
                dedupKey: `task:${taskId}:blocked_workflow_action:${attemptId}:${currentStepId}:${action}`,
            });
            return;
        }

        // Accumulate context as refs (no blobs).
        const attempt = getAttemptById(attemptId);
        const acc = state.accumulated_context && typeof state.accumulated_context === 'object' ? state.accumulated_context : {};
        acc[currentStepId] = {
            step_id: currentStepId,
            task_id: taskId,
            attempt_id: attemptId,
            response_text_artifact_id: attempt?.response_text_artifact_id || null,
            output_preview: _truncate(outputText, 500),
        };

        const completed = new Set(state.completed_steps);
        completed.add(currentStepId);

        const nextIndex = currentIndex + 1;
        task.state = task.state || {};
        task.state.workflow_state = {
            current_step_index: nextIndex,
            completed_steps: Array.from(completed),
            failed_steps: state.failed_steps,
            accumulated_context: acc,
        };

        // Persist state on the completed task (audit-friendly).
        updateTask(taskId, { task });

        if (nextIndex >= steps.length) {
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_ORCHESTRATION_WORKFLOW_DONE',
                payload: { attemptId, workflow_id: task?.meta?.workflow_id || task?.meta?.id, total_steps: steps.length },
                dedupKey: `task:${taskId}:workflow_done:${attemptId}`,
            });
            return;
        }

        const nextStep = steps[nextIndex];
        const nextStepId = nextStep?.id ? String(nextStep.id) : `step-${nextIndex}`;
        const nextAction = nextStep?.action ? String(nextStep.action) : 'execute_prompt';
        if (nextAction !== 'execute_prompt') {
            updateTask(taskId, {
                status: 'BLOCKED',
                blocked_reason: 'WORKFLOW_ACTION_UNSUPPORTED',
                blocked_at_ms: now,
                blocked_details_json: _safeJsonString({ attemptId, step_id: nextStepId, action: nextAction }),
            });
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_BLOCKED_WORKFLOW_UNSUPPORTED',
                payload: { attemptId, step_id: nextStepId, action: nextAction },
                dedupKey: `task:${taskId}:blocked_workflow_action:${attemptId}:${nextStepId}:${nextAction}`,
            });
            return;
        }

        const childId = `task-${_hashId(`${taskId}|${attemptId}|${nextStepId}`)}`;
        const rootWorkflowId = task?.meta?.workflow_id || task?.meta?.id || taskId;
        const missionId = task?.meta?.mission_id || task?.mission?.mission_id || null;

        const sys = typeof task?.spec?.payload?.system_message === 'string' ? task.spec.payload.system_message : '';
        const prompt =
            (nextStep?.config && typeof nextStep.config === 'object' && typeof nextStep.config.prompt === 'string'
                ? nextStep.config.prompt
                : null) ||
            (typeof nextStep?.description === 'string' ? nextStep.description : null) ||
            (typeof nextStep?.name === 'string' ? nextStep.name : null) ||
            `Execute workflow step ${nextIndex + 1}`;

        const inputs = Array.from(completed).map(stepId => ({
            type: 'task_result',
            task_id: acc?.[stepId]?.task_id || taskId,
            attempt: 'latest',
            format: 'text',
            label: `workflow_step_output:${String(stepId)}`,
        }));

        const childTask = {
            ...task,
            meta: {
                ...(task.meta || {}),
                id: childId,
                parent_id: taskId,
                workflow_id: rootWorkflowId,
                mission_id: missionId || undefined,
                created_at: new Date(now).toISOString(),
                source: 'self_generated',
                tags: Array.from(new Set([...(task?.meta?.tags || []), 'workflow_step'])),
            },
            spec: {
                ...(task.spec || {}),
                payload: {
                    system_message: sys,
                    user_message: String(prompt),
                    context: {
                        ...(task?.spec?.payload?.context && typeof task.spec.payload.context === 'object' ? task.spec.payload.context : {}),
                        inputs,
                        workflow_step_id: nextStepId,
                        workflow_step_index: nextIndex,
                    },
                },
                execution: {
                    ...(task?.spec?.execution || {}),
                    strategy: 'MULTI_STEP',
                    workflow_config: wf,
                },
            },
            policy: {
                ...(task.policy || {}),
                dependencies: [taskId],
                execute_after: null,
            },
            mission: {
                ...(task.mission || {}),
                mission_id: missionId,
                step_id: nextStepId,
                step_index: nextIndex,
            },
            state: {
                ...(task.state || {}),
                status: 'PENDING',
                workflow_state: task.state.workflow_state,
            },
            result: {},
        };

        // Atomic creation + audit. insertTask also registers TASK_CREATED.
        insertTask(childTask, { stage: TASK_STAGES.READY, status: 'PENDING', actor: 'system', ifNotExists: true });

        recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: now,
            actorType: 'system',
            eventType: 'TASK_ORCHESTRATION_NEXT_STEP_CREATED',
            payload: {
                from_task_id: taskId,
                from_attempt_id: attemptId,
                to_task_id: childId,
                workflow_id: rootWorkflowId,
                step_id: nextStepId,
                step_index: nextIndex,
            },
            dedupKey: `task:${taskId}:next_step:${attemptId}:${nextStepId}`,
        });
    }
}

export { TaskOrchestrationWorker };
