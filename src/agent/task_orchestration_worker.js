// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { insertArtifact } from '#infra/db/artifact_repo';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { getAttemptById } from '#infra/db/task_attempt_repo';
import { extendTaskLock, insertTask, releaseTaskLock, TASK_STAGES, updateTask } from '#infra/db/task_repo';
import { resilientLock } from '#infra/locks/resilient_lock';
import { putText, readText } from '#infra/storage/artifact_store';
import { ValidationService } from '#orchestrator/validation/validation_service';
import { buildWorkflowNextStepTask } from '#agent/workflow_next_step_builder';
import fs from 'node:fs/promises';

/**
 * @file Task orchestration worker
 * @description Orchestrates post-run task processing for ITERATIVE and MULTI_STEP strategies.
 * Claims DB locks, records events, persists feedback artifacts and creates child tasks when needed.
 * @module src/agent/task_orchestration_worker.js
 */

/**
 * Options for `TaskOrchestrationWorker` constructor.
 * @typedef {Object} WorkerOptions
 * @property {any} [browserPool] - Browser pool instance used for circuit-breaker checks.
 * @property {string} [workerId] - Optional worker identifier.
 * @property {number} [intervalMs] - Tick interval in milliseconds.
 * @property {number} [batchSize] - Maximum number of tasks to fetch per tick.
 * @property {number} [pausedRescheduleDelayMs] - Delay applied when dispatch is paused.
 * @property {OutputMissingEscalation} [outputMissingEscalation] - Escalation policy for missing attempt outputs.
 */

/**
 * @typedef {Object} OutputMissingEscalation
 * @property {number} windowMs - Time window in milliseconds to count missing-output events.
 * @property {number} threshold - Number of occurrences in window before blocking the task.
 */

/**
 * Row returned by the worker's DB query in `tick()`.
 * @typedef {Object} TaskRow
 * @property {any} id
 * @property {any} mission_id
 * @property {string|null} task_json
 * @property {string|null} result_json
 * @property {any} latest_attempt_id
 * @property {number} updated_at_ms
 */

/**
 * Minimal in-memory Task shape (parsed from task_json). Fields are optional and dynamic.
 * @typedef {Object} Task
 * @property {Object<string, any>} [spec]
 * @property {Object<string, any>} [meta]
 * @property {Object<string, any>} [state]
 * @property {Object<string, any>} [policy]
 * @property {Object<string, any>} [mission]
 */

/**
 * Partial Attempt record shape.
 * @typedef {Object} Attempt
 * @property {any} id
 * @property {any} response_v2_json_artifact_id
 * @property {any} response_text_artifact_id
 */

/**
 * Result returned by ValidationService.validate().
 * @typedef {Object} ValidationResult
 * @property {boolean} passed
 * @property {number} overall_score
 * @property {Array<string|Object>} issues
 */

/**
 * Workflow orchestration state stored inside `task.state.workflow_state`.
 * @typedef {Object} WorkflowState
 * @property {number} current_step_index
 * @property {string[]} completed_steps
 * @property {string[]} failed_steps
 * @property {Object<string, any>} accumulated_context
 */

/**
 * Return shape from `putText()` used to create artifacts.
 * @typedef {Object} PutTextResult
 * @property {string} mime
 * @property {number} sizeBytes
 * @property {string} sha256
 * @property {string} storageUri
 */

/**
 * Shape of event records passed to `recordEvent()`.
 * @typedef {Object} EventRecord
 * @property {string} entityType
 * @property {string|number} entityId
 * @property {number} tsMs
 * @property {string} actorType
 * @property {string} eventType
 * @property {Object<string, any>} payload
 * @property {string} dedupKey
 */

/**
 * Minimal DB interface expected from `getDb()` (better-sqlite3-like).
 * @typedef {Object} DBInterface
 * @property {function(string): {get: function(...any): any, all: function(...any): any[], run: function(...any): {changes?: number}}} prepare
 */
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

/**
 * Read the most relevant textual output for an attempt.
 * ✅ P0-14: Retry logic para lidar com race entre putText() e read.
 * Sources checked: response_v2_json artifact, response_text artifact, legacy result_json storage file.
 * @private
 * @param {{taskId?: string|number, attemptId?: string|number, resultJson?: string|Object, maxRetries?: number, retryDelayMs?: number}} [opts]
 * @returns {Promise<string>} Returns empty string when no output is available.
 */
async function _readAttemptOutputText({ taskId, attemptId, resultJson, maxRetries = 3, retryDelayMs = 50 } = {}) {
    if (!taskId || !attemptId) return '';

    // ✅ P0-14: Retry loop para lidar com artifact ainda sendo escrito
    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
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
                        if (retryCount > 0) {
                            log(
                                'DEBUG',
                                `[_readAttemptOutputText] Found output after ${retryCount} retries`,
                                String(taskId)
                            );
                        }
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
                if (typeof raw === 'string' && raw.trim()) {
                    if (retryCount > 0) {
                        log(
                            'DEBUG',
                            `[_readAttemptOutputText] Found output after ${retryCount} retries`,
                            String(taskId)
                        );
                    }
                    return raw;
                }
            } catch (_) {
                /* ignore */
            }
        }

        // 3) Legacy fallback: tasks.result_json.storage.text_file
        let parsed = null;
        try {
            parsed = resultJson ? JSON.parse(String(resultJson)) : null;
        } catch (_) {
            // Parse failed, keep null
        }
        const p = parsed?.storage?.text_file || parsed?.storage?.textFile || null;
        if (p) {
            try {
                const raw = await fs.readFile(String(p), 'utf8');
                if (typeof raw === 'string' && raw.trim()) {
                    if (retryCount > 0) {
                        log(
                            'DEBUG',
                            `[_readAttemptOutputText] Found output after ${retryCount} retries`,
                            String(taskId)
                        );
                    }
                    return raw;
                }
            } catch (_) {
                /* ignore */
            }
        }

        // ✅ P0-14: Se não encontrou e ainda tem retries, aguardar antes de tentar novamente
        if (retryCount < maxRetries - 1) {
            await _sleep(retryDelayMs);
        }
    }

    return '';
}

function _ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Add or replace an input object into an inputs array by matching `type` or `label`.
 * @private
 * @param {{inputs?: Array<Object>, next?: Object}} [opts]
 * @returns {Array<Object>}
 */
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
        accumulated_context:
            ws.accumulated_context && typeof ws.accumulated_context === 'object' ? ws.accumulated_context : {},
    };
}

/**
 * TaskOrchestrationWorker
 *
 * Scans the database for finished tasks with orchestration strategies and
 * applies orchestration logic (ITERATIVE or MULTI_STEP). This worker claims
 * task locks, records events, persists feedback artifacts and creates child
 * tasks when required.
 *
 * Side effects: updates `tasks` rows, records events via `recordEvent()`,
 * writes artifact storage via `putText()` and `insertArtifact()`, and creates
 * child tasks via `insertTask()`.
 *
 * @class
 * @param {WorkerOptions} [options] - Configuration options for the worker.
 */
class TaskOrchestrationWorker {
    /**
     * Create a new TaskOrchestrationWorker.
     * @param {WorkerOptions} [options]
     */
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
        // ✅ P0-2.5: Lock management delegado ao ResilientLockManager (sem tracking manual)
        this.validationService = new ValidationService({ nerv: null });
    }

    /**
     * Start the worker main loop. Non-blocking.
     * @public
     * @returns {void}
     */
    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[TaskOrchestrationWorker] started (interval=${this.intervalMs}ms, batch=${this.batchSize})`);
    }

    /**
     * Stop the worker.
     * ✅ P0-2.5: Lock cleanup automático via ResilientLockManager (sem manual cleanup).
     * @public
     * @returns {void}
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[TaskOrchestrationWorker] stopped');
    }

    /**
     * Verifica se o dispatch deve ser pausado baseado no circuit breaker do browser pool.
     * @private
     * @returns {boolean} True se o sistema deve pausar dispatch.
     */
    _shouldPauseDispatch() {
        return Boolean(this.browserPool?.circuitBreaker?.shouldPauseSystem?.());
    }

    /**
     * ✅ P1-17: Safe wrapper for updateTask() that catches OptimisticLockError.
     * Prevents worker crashes when concurrent updates cause optimistic lock conflicts.
     *
     * @private
     * @param {string} taskId - Task ID to update
     * @param {object} updates - Update payload
     * @param {object} [options] - Options
     * @param {boolean} [options.critical=false] - If true, re-throws OptimisticLockError (caller MUST handle)
     * @param {string} [options.context=''] - Context string for logging
     * @returns {boolean} True if update succeeded, false if conflict occurred (non-critical only)
     * @throws {Error} Re-throws OptimisticLockError if options.critical=true
     */
    _safeUpdateTask(taskId, updates, { critical = false, context = '' } = {}) {
        try {
            updateTask(taskId, updates);
            return true;
        } catch (err) {
            if (err && err.name === 'OptimisticLockError') {
                const msg = context
                    ? `[TaskOrchestrationWorker] ${context}: Task ${taskId} update conflict after retries`
                    : `[TaskOrchestrationWorker] Task ${taskId} update conflict after retries`;

                log('WARN', msg, String(taskId));

                if (critical) {
                    throw err; // Re-throw for critical operations
                }

                return false; // Non-critical: log and continue
            }

            // Re-throw all other errors (unexpected)
            throw err;
        }
    }

    /**
     * Check events table to see whether orchestration was already applied for a given task+attempt.
     * @private
     * @param {{taskId?: any, attemptId?: any}} [opts]
     * @returns {boolean}
     */
    _hasAppliedOrchestration({ taskId, attemptId } = {}) {
        const db = getDb();
        const dedupKey = `task:${taskId}:orchestrated:${attemptId}`;
        return Boolean(db.prepare('SELECT 1 AS ok FROM events WHERE dedup_key = ? LIMIT 1').get(dedupKey)?.ok);
    }

    /**
     * Try to claim orchestration lock on a task row using ResilientLockManager.
     * ✅ P0-2.5: Usa ResilientLockManager para garantir cleanup automático em crash.
     * @private
     * @param {{taskId?: any, nowMs?: number, lockTtlMs?: number}} [opts]
     * @returns {Promise<boolean>} True when lock was acquired.
     */
    async _claimOrchestrationLock({ taskId, nowMs, lockTtlMs = 300000 } = {}) {
        const db = getDb();
        const now = Number(nowMs) || _now();
        const expires = now + Math.max(5000, Number(lockTtlMs) || 300000);

        return await resilientLock.acquire(
            `task:orch:${taskId}`,
            async () => {
                // Acquire: Update DB lock
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
            },
            async () => {
                // Release: Clear DB lock
                releaseTaskLock({ taskId, workerId: this.workerId });
            },
            { taskId, workerId: this.workerId, acquiredAt: now }
        );
    }

    /**
     * Processa um lote de tarefas concluídas que requerem orquestração pós-execução.
     * Busca tarefas ARCHIVED/DONE com estratégias ITERATIVE ou MULTI_STEP, reivindica locks
     * e aplica lógica de orquestração (feedback, child tasks, etc.).
     * @returns {Promise<void>}
     * @throws {Error} Erros são logados mas não relançados para não interromper o loop.
     * @sideEffects Modifica estado do banco de dados, cria artifacts, child tasks e eventos.
     */
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
                // ✅ P0-2.5: Usa ResilientLockManager (await porque é async agora)
                const lockAcquired = await this._claimOrchestrationLock({ taskId, nowMs: now });
                if (!lockAcquired) {
                    continue;
                }

                try {
                    // ✅ P0-2.5: Setup lock extension usando ResilientLock.extend()
                    const ORCHESTRATION_LOCK_TTL_MS = 300000; // 5 minutes
                    const lockExtensionInterval = setInterval(async () => {
                        // BUG-ORCH-1: async setInterval callback must catch rejections to avoid
                        // unhandled Promise rejections which crash Node.js 24+ by default.
                        try {
                            await resilientLock.extend(`task:orch:${taskId}`, () => {
                                extendTaskLock({
                                    taskId,
                                    workerId: this.workerId,
                                    lockTtlMs: ORCHESTRATION_LOCK_TTL_MS,
                                });
                                return true;
                            });
                        } catch (extErr) {
                            log(
                                'WARN',
                                `[TaskOrchestrationWorker] lock extension failed for ${taskId}: ${extErr?.message || String(extErr)}`
                            );
                        }
                    }, 30000); // Extend every 30s

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
                    } finally {
                        clearInterval(lockExtensionInterval);
                    }
                } catch (err) {
                    log(
                        'WARN',
                        `[TaskOrchestrationWorker] task ${taskId} orchestration failed: ${err?.message || String(err)}`
                    );
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
                    // ✅ P0-2.5: Release via ResilientLockManager (cleanup automático)
                    await resilientLock.release(`task:orch:${taskId}`);
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
            // Parse failed, keep null
        }
        if (!task || typeof task !== 'object') return { finalized: true };

        const strategy = task?.spec?.execution?.strategy || null;
        if (strategy !== 'ITERATIVE' && strategy !== 'MULTI_STEP') {
            // Safety: block unknown strategy.
            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
                    status: 'BLOCKED',
                    blocked_reason: 'ORCH_STRATEGY_UNKNOWN',
                    blocked_at_ms: _now(),
                    blocked_details_json: _safeJsonString({ attemptId, strategy }),
                },
                { context: 'Block unknown strategy' }
            );
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

    /**
     * Handle missing output for an attempt. If threshold exceeded inside window, blocks the task.
     * @private
     * @param {{taskId?: any, attemptId?: any}} [opts]
     * @returns {Promise<boolean>} True if task was blocked due to missing output.
     */
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
            // No dedupKey: each occurrence must be counted independently for threshold detection.
            // Using INSERT OR IGNORE with a fixed dedupKey would cap the count at 1 per (taskId,attemptId),
            // preventing the threshold from ever being reached. Without a dedupKey, the COUNT query
            // can accumulate across ticks and correctly trigger the escalation when the limit is exceeded.
        });

        const windowMs = Math.max(60000, Number(this.outputMissingEscalation?.windowMs || 600000) || 600000);
        const threshold = Math.max(1, Number(this.outputMissingEscalation?.threshold || 3) || 3);

        const recent =
            db
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

        // ✅ P1-17: Safe update with OptimisticLockError handling
        this._safeUpdateTask(
            taskId,
            {
                status: 'BLOCKED',
                blocked_reason: 'ORCH_OUTPUT_MISSING',
                blocked_at_ms: now,
                blocked_details_json: _safeJsonString({ attemptId, recent, windowMs }),
            },
            { context: 'Block output missing' }
        );

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

    /**
     * Handle ITERATIVE orchestration: validate output, persist iteration_state, schedule retry or block.
     * @private
     * @param {{taskId?: any, attemptId?: any, task?: any, outputText?: any}} [opts]
     * @returns {Promise<void>}
     */
    async _handleIterative({ taskId, attemptId, task, outputText } = {}) {
        const now = _now();
        const cfg = task?.spec?.execution?.iterative_config || {};
        const maxIterations = Math.max(1, Number(cfg?.max_iterations ?? 3) || 3);

        const existingState = task.state && typeof task.state === 'object' ? task.state : {};
        const iter =
            existingState.iteration_state && typeof existingState.iteration_state === 'object'
                ? existingState.iteration_state
                : {};
        const currentIteration = Math.max(0, Number(iter.current_iteration || 0) || 0);
        const nextIteration = currentIteration + 1;

        const validators = _ensureArray(task?.spec?.validation?.validators);
        const criteriaRaw =
            cfg?.validation_criteria || task?.spec?.execution?.iterative_config?.validation_criteria || {};
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
        // ✅ P1-17: Safe update with OptimisticLockError handling
        this._safeUpdateTask(taskId, { task }, { context: 'Persist quality metrics' });

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

            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
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
                },
                { context: 'Block for manual review' }
            );

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

        // P2-11: Fail-fast for hopeless validation scores.
        // If score is extremely low, further iterations are unlikely to succeed.
        const MIN_SCORE_THRESHOLD = 0.3;
        if (validationResult.overall_score < MIN_SCORE_THRESHOLD && nextIteration > 1) {
            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
                    status: 'FAILED',
                    stage: TASK_STAGES.ARCHIVED,
                    failed_at_ms: now,
                    last_error: `VALIDATION_HOPELESS: score ${validationResult.overall_score.toFixed(2)} < ${MIN_SCORE_THRESHOLD} after ${nextIteration} iterations`,
                },
                { context: 'Mark as failed (hopeless)' }
            );
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_ORCHESTRATION_HOPELESS',
                payload: {
                    attemptId,
                    iteration: nextIteration,
                    overall_score: validationResult.overall_score,
                    threshold: MIN_SCORE_THRESHOLD,
                },
                dedupKey: `task:${taskId}:orch_hopeless:${attemptId}`,
            });
            return;
        }

        if (nextIteration >= maxIterations) {
            // Mark FAILED: max iterations exhausted without passing validation.
            // Consistent with the "hopeless" branch above which also marks FAILED.
            // Task staying DONE would be semantically incorrect (it did NOT meet quality criteria).
            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
                    status: 'FAILED',
                    stage: TASK_STAGES.ARCHIVED,
                    failed_at_ms: now,
                    last_error: `MAX_ITERATIONS_REACHED: validation did not pass after ${nextIteration} iterations (max=${maxIterations})`,
                },
                { context: 'Mark failed at max iterations' }
            );
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
        task.spec.payload.context =
            task.spec.payload.context && typeof task.spec.payload.context === 'object' ? task.spec.payload.context : {};

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
        // ✅ P1-17: Safe update with OptimisticLockError handling (CRITICAL operation)
        this._safeUpdateTask(
            taskId,
            {
                task,
                stage: TASK_STAGES.READY,
                status: 'PENDING',
                execute_after_ms: executeAfterMs,
                last_error:
                    `ORCHESTRATION_RETRY_SCHEDULED(iter=${nextIteration}, score=${Number(validationResult.overall_score || 0).toFixed(1)})`.slice(
                        0,
                        2000
                    ),
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
            },
            { critical: true, context: 'Rearm task for retry' }
        ); // CRITICAL: must succeed for retry

        // ✅ P0-14: Small delay para garantir artifact flush completo antes de próxima leitura
        await _sleep(100);

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

    /**
     * Persist a human-readable feedback artifact and register it in the artifacts repo.
     * @private
     * @param {{taskId?: any, attemptId?: any, validationResult?: any, outputPreview?: any}} [opts]
     * @returns {Promise<any>} Artifact id returned by insertArtifact().
     */
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

        // NERV audit: emit event for orchestration feedback artifact creation
        try {
            recordEvent({
                entityType: 'artifact',
                entityId: String(artId),
                tsMs: now,
                actorType: 'system',
                eventType: 'ORCHESTRATION_FEEDBACK_STORED',
                payload: { taskId, attemptId, kind: 'orchestration_feedback' },
            });
        } catch (_) {
            /* best-effort */
        }

        return artId;
    }

    /**
     * Handle MULTI_STEP orchestration: update workflow_state, persist completed step and create child task for next step.
     * @private
     * @param {{taskId?: any, attemptId?: any, task?: any, outputText?: any}} [opts]
     * @returns {Promise<void>}
     */
    async _handleMultiStep({ taskId, attemptId, task, outputText } = {}) {
        const now = _now();
        const wf = task?.spec?.execution?.workflow_config || null;
        const steps = _ensureArray(wf?.steps);
        if (!steps.length) {
            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
                    status: 'BLOCKED',
                    blocked_reason: 'WORKFLOW_CONFIG_MISSING',
                    blocked_at_ms: now,
                    blocked_details_json: _safeJsonString({ attemptId }),
                },
                { context: 'Block workflow config missing' }
            );
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
            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
                    status: 'BLOCKED',
                    blocked_reason: 'WORKFLOW_ACTION_UNSUPPORTED',
                    blocked_at_ms: now,
                    blocked_details_json: _safeJsonString({ attemptId, step_id: currentStepId, action }),
                },
                { context: 'Block workflow action unsupported' }
            );
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
        const acc =
            state.accumulated_context && typeof state.accumulated_context === 'object' ? state.accumulated_context : {};
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
        // ✅ P1-17: Safe update with OptimisticLockError handling
        this._safeUpdateTask(taskId, { task }, { context: 'Persist workflow state' });

        if (nextIndex >= steps.length) {
            recordEvent({
                entityType: 'task',
                entityId: taskId,
                tsMs: now,
                actorType: 'system',
                eventType: 'TASK_ORCHESTRATION_WORKFLOW_DONE',
                payload: {
                    attemptId,
                    workflow_id: task?.meta?.workflow_id || task?.meta?.id,
                    total_steps: steps.length,
                },
                dedupKey: `task:${taskId}:workflow_done:${attemptId}`,
            });
            return;
        }

        const nextStep = steps[nextIndex];
        const nextStepId = nextStep?.id ? String(nextStep.id) : `step-${nextIndex}`;
        const nextAction = nextStep?.action ? String(nextStep.action) : 'execute_prompt';
        if (nextAction !== 'execute_prompt') {
            // ✅ P1-17: Safe update with OptimisticLockError handling
            this._safeUpdateTask(
                taskId,
                {
                    status: 'BLOCKED',
                    blocked_reason: 'WORKFLOW_ACTION_UNSUPPORTED',
                    blocked_at_ms: now,
                    blocked_details_json: _safeJsonString({ attemptId, step_id: nextStepId, action: nextAction }),
                },
                { context: 'Block next step action unsupported' }
            );
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

        const {
            childTask,
            childId,
            workflowId: rootWorkflowId,
        } = buildWorkflowNextStepTask({
            parentTask: task,
            parentTaskId: String(taskId),
            attemptId: attemptId ? String(attemptId) : null,
            nextStep,
            nextStepIndex: nextIndex,
            workflowConfig: wf,
            completedStepIds: Array.from(completed).map(stepId => String(stepId)),
            accumulatedContext: acc,
            nowMs: now,
            source: 'self_generated',
        });

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
