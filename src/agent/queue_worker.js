// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { releaseTaskLockForAttempt } from '#agent/task_attempt_invariants';
import { insertArtifact } from '#infra/db/artifact_repo';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { updateAttempt, upsertAttempt } from '#infra/db/task_attempt_repo';
import { claimNextEligibleTask, TASK_STAGES, updateTask } from '#infra/db/task_repo';
import { putJson, putText, readText } from '#infra/storage/artifact_store';
import { promises as fs } from 'node:fs';

/**
 * Opções do construtor do QueueWorker.
 * @typedef {object} QueueWorkerOptions
 * @property {any} kernel - Instância do kernel com método executeTask() (obrigatório).
 * @property {string} workerId - ID único do worker (obrigatório).
 * @property {number} [intervalMs=250] - Intervalo entre ticks em ms.
 * @property {number} [lockTtlMs=60000] - TTL do lock em ms.
 * @property {number} [maxConcurrentTasks=2] - Máximo de tarefas concorrentes.
 */

/**
 * Parâmetros para composição de prompt do driver.
 * @typedef {object} DriverPromptParams
 * @property {string} [systemMessage] - Mensagem do sistema.
 * @property {string} [userMessage] - Mensagem do usuário.
 */

/** @param {any} ms */
function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function _makeCorrelationId() {
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 8);
    return `c_${ts}_${rnd}`;
}

/** @param {any} text @param {any} maxLen */
function _truncate(text, maxLen) {
    const s = typeof text === 'string' ? text : String(text ?? '');
    const n = Number(maxLen) || 0;
    if (!n || n <= 0) return '';
    return s.length > n ? s.slice(0, n) : s;
}

/**
 * Compõe um prompt para o driver baseado em mensagens do sistema e usuário.
 * @param {DriverPromptParams} [params={}] - Parâmetros do prompt.
 * @returns {string} Prompt composto ou string vazia se não houver mensagem do usuário.
 */
function _composeDriverPrompt(params = {}) {
    const { systemMessage, userMessage } = params;
    const sys = typeof systemMessage === 'string' ? systemMessage.trim() : '';
    const usr = typeof userMessage === 'string' ? userMessage.trim() : '';
    if (!usr) return '';
    return sys ? `SYSTEM:\n${sys}\n\nUSER:\n${usr}` : usr;
}

/** @param {any} taskId */
async function _readTextFromTaskLatestResult(taskId) {
    const db = getDb();
    const row = /** @type {any} */ (db.prepare('SELECT result_json FROM tasks WHERE id = ?').get(taskId));
    if (!row?.result_json) return '';
    let parsed;
    try {
        parsed = JSON.parse(row.result_json);
    } catch (/** @type {any} */ _) {
        parsed = null;
    }
    const p = parsed?.storage?.text_file || parsed?.storage?.textFile || null;
    if (!p) return '';
    try {
        return await fs.readFile(String(p), 'utf8');
    } catch (/** @type {any} */ _) {
        return '';
    }
}

/** @param {any} inputs @param {any} [currentTaskId] */
async function _resolveContextInputs(inputs = [], currentTaskId = null) {
    if (!Array.isArray(inputs) || inputs.length === 0) return '';

    const MAX_PER_INPUT_CHARS = Math.max(1000, Number(process.env.QUEUE_INPUT_MAX_CHARS || 50000) || 50000);
    const MAX_TOTAL_CHARS = Math.max(5000, Number(process.env.QUEUE_INPUT_MAX_TOTAL_CHARS || 200000) || 200000);

    const parts = [];
    let total = 0;
    for (const input of inputs) {
        const type = input?.type ? String(input.type) : null;
        if (type === 'task_result') {
            const srcTaskId = input?.task_id ? String(input.task_id) : null;
            if (!srcTaskId) continue;

            // Cycle detection: skip self-references to prevent reading from incomplete/stale results.
            if (currentTaskId && srcTaskId === currentTaskId) {
                log(
                    'WARN',
                    `[QUEUE] Skipping self-referencing context input (task_id=${srcTaskId}) in task ${currentTaskId}`
                );
                continue;
            }

            const attempt = input?.attempt ? String(input.attempt) : 'latest';
            const format = input?.format ? String(input.format) : 'text';
            if (format !== 'text') {
                // BUG-CONTEXT-INPUT-SILENT-DROP: non-text formats silently ignored → warn for debuggability
                log(
                    'WARN',
                    `[QUEUE] context.inputs: unsupported format '${format}' for task_result(task_id=${srcTaskId}) — only 'text' is supported. Update the task spec to use format='text'.`
                );
                continue;
            }

            let text = '';
            if (attempt === 'latest') {
                text = await _readTextFromTaskLatestResult(srcTaskId);
            } else {
                // Attempt-specific path fallback (canonical): artifacts/responses/<taskId>/<attemptId>.txt
                // If missing, just ignore.
                try {
                    const guess = input?.storage_uri ? String(input.storage_uri) : null;
                    if (guess) {
                        text = await fs.readFile(guess, 'utf8');
                    }
                } catch (/** @type {any} */ _) {
                    text = '';
                }
            }

            if (!text) continue;
            const clipped = _truncate(text, MAX_PER_INPUT_CHARS);
            const header = `---\nINPUT task_result(task_id=${srcTaskId}, attempt=${attempt}, format=${format})\n`;
            const footer = `\n---`;
            const candidate = `${header}${clipped}${footer}`;
            if (total + candidate.length > MAX_TOTAL_CHARS) break;
            total += candidate.length;
            parts.push(candidate);
            continue;
        }

        if (type === 'artifact_text') {
            const artifactId = input?.artifact_id ? String(input.artifact_id) : null;
            if (!artifactId) continue;
            let text;
            try {
                const raw = await readText(artifactId);
                text = typeof raw === 'string' ? raw : '';
            } catch (/** @type {any} */ _) {
                text = '';
            }
            if (!text) continue;

            const label = input?.label ? String(input.label) : '';
            const clipped = _truncate(text, MAX_PER_INPUT_CHARS);
            const header = `---\nINPUT artifact_text(artifact_id=${artifactId}${label ? `, label=${label}` : ''})\n`;
            const footer = `\n---`;
            const candidate = `${header}${clipped}${footer}`;
            if (total + candidate.length > MAX_TOTAL_CHARS) break;
            total += candidate.length;
            parts.push(candidate);
            continue;
        }
    }

    return parts.length ? `\n\n${parts.join('\n\n')}` : '';
}

/** Classe exportada: QueueWorker. */
class QueueWorker {
    /**
     * Cria um worker da fila para reivindicar e executar tarefas.
     * @param {QueueWorkerOptions} options - Opções de configuração do worker.
     */
    constructor(options) {
        const { kernel, workerId, intervalMs = 250, lockTtlMs = 60000, maxConcurrentTasks = 2 } = options;
        if (!kernel || typeof kernel.executeTask !== 'function') {
            throw new Error('[QueueWorker] kernel.executeTask required');
        }
        if (!workerId) {
            throw new Error('[QueueWorker] workerId required');
        }

        this.kernel = kernel;
        this.workerId = workerId;
        this.intervalMs = Math.max(50, Number(intervalMs) || 250);
        this.lockTtlMs = Math.max(1000, Number(lockTtlMs) || 60000);
        this.maxConcurrentTasks = Math.max(1, Number(maxConcurrentTasks) || 2);

        this._timer = null;
        this._running = false;
        this._stopped = false;
    }

    /**
     * ✅ P1-17: Safe wrapper for updateTask() that catches OptimisticLockError.
     * @private
     * @param {any} taskId
     * @param {any} updates
     */
    _safeUpdateTask(taskId, updates, { critical = false, context = '' } = {}) {
        try {
            updateTask(taskId, updates);
            return true;
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            if (err && err.name === 'OptimisticLockError') {
                log('WARN', `[QueueWorker] ${context || 'Update'}: Task ${taskId} conflict`, String(taskId));
                if (critical) throw err;
                return false;
            }
            throw err;
        }
    }

    /**
     * Inicia o worker, começando a reivindicar e executar tarefas periodicamente.
     * @returns {void}
     * @sideEffects Inicia timer interno e executa tick imediatamente.
     */
    start() {
        if (this._timer) return;
        this._stopped = false;

        // Kick once immediately.
        void this.tick();

        this._timer = setInterval(() => {
            void this.tick();
        }, this.intervalMs);

        log('INFO', `[QueueWorker] started (interval=${this.intervalMs}ms, maxConcurrent=${this.maxConcurrentTasks})`);
    }

    /**
     * Para o worker, cancelando o timer e impedindo novas execuções.
     * @returns {void}
     * @sideEffects Cancela timer interno e marca worker como parado.
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[QueueWorker] stopped');
    }

    /**
     * Executa um ciclo do worker: reivindica tarefas elegíveis e as executa.
     * @returns {Promise<void>}
     * @throws {Error} Se houver erro na execução de tarefa (logado, não relançado).
     * @sideEffects Modifica estado do banco de dados, executa tarefas via kernel.
     */
    async tick() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const db = getDb();
            const now = Date.now();

            const inflight =
                /** @type {any} */ (
                    db
                        .prepare(
                            `
                    SELECT COUNT(1) AS c
                    FROM tasks
                    WHERE locked_by = @workerId
                      AND lock_expires_at_ms IS NOT NULL
                      AND lock_expires_at_ms > @now
                      AND stage = @stage
                      AND status IN ('PENDING', 'RUNNING')
                `
                        )
                        .get({ workerId: this.workerId, now, stage: TASK_STAGES.READY })
                )?.c || 0;

            const availableSlots = Math.max(0, this.maxConcurrentTasks - Number(inflight || 0));
            if (availableSlots <= 0) {
                return;
            }

            for (let i = 0; i < availableSlots; i++) {
                const claimed = /** @type {any} */ (
                    claimNextEligibleTask({
                        workerId: this.workerId,
                        nowMs: now,
                        lockTtlMs: this.lockTtlMs,
                    })
                );

                if (!claimed || !claimed.task) {
                    break;
                }

                const task = claimed.task;
                const taskId = task?.meta?.id;
                if (!taskId) {
                    continue;
                }

                // Final guard: do not dispatch tasks without user_message.
                const userMessage = task?.spec?.payload?.user_message;
                if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
                    this._safeUpdateTask(taskId, {
                        status: 'FAILED',
                        stage: TASK_STAGES.ARCHIVED,
                        last_error: 'TASK_INVALID: spec.payload.user_message missing',
                        failed_at_ms: Date.now(),
                    });
                    // BUG-QUEUE-INVALID-NO-EVENT: record event for observability (no attempt created yet)
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: Date.now(),
                        actorType: 'system',
                        eventType: 'TASK_INVALID_REJECTED',
                        payload: { reason: 'TASK_INVALID', detail: 'spec.payload.user_message missing or empty' },
                        dedupKey: `task:${taskId}:invalid_rejected:user_message`,
                    });
                    releaseTaskLockForAttempt(/** @type {any} */ ({ taskId, context: 'queue_invalid_task' }));
                    continue;
                }

                // Enforce max attempts at DISPATCH time (attempt == correlationId).
                const maxAttempts = Math.max(1, Number(task?.policy?.max_attempts ?? 3) || 3);
                const currentAttempts = Number(claimed?.row?.attempts ?? 0) || 0;
                if (currentAttempts >= maxAttempts) {
                    this._safeUpdateTask(taskId, {
                        status: 'FAILED',
                        stage: TASK_STAGES.ARCHIVED,
                        last_error: `MAX_ATTEMPTS_REACHED(${currentAttempts}/${maxAttempts})`,
                        failed_at_ms: Date.now(),
                    });
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: Date.now(),
                        actorType: 'system',
                        eventType: 'TASK_MAX_ATTEMPTS_REACHED',
                        payload: { currentAttempts, maxAttempts },
                        dedupKey: `task:${taskId}:max_attempts:${currentAttempts}:${maxAttempts}`,
                    });
                    releaseTaskLockForAttempt(/** @type {any} */ ({ taskId, context: 'queue_max_attempts' }));
                    continue;
                }

                const correlationId = _makeCorrelationId();

                // Persist correlation id for debuggability / abort routing.
                // Also set latest_attempt_id early so projectors/watchdogs can treat stale events correctly.
                this._safeUpdateTask(taskId, { last_correlation_id: correlationId, latest_attempt_id: correlationId });

                // Create attempt record (attempt == correlationId).
                const missionId = task?.meta?.mission_id || task?.mission?.mission_id || null;
                upsertAttempt({
                    id: correlationId,
                    task_id: taskId,
                    mission_id: missionId,
                    status: 'DISPATCHED',
                    worker_id: this.workerId,
                    created_at_ms: now,
                    driver_target: task?.spec?.target || null,
                    model: task?.spec?.model || null,
                });

                recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'TASK_DISPATCHED',
                    payload: { workerId: this.workerId, correlationId },
                    dedupKey: `task:${taskId}:dispatch:${correlationId}`,
                });

                // Ensure prompt template artifact exists (best-effort; dual storage).
                try {
                    if (!task?.prompt_template_artifact_id) {
                        const tpl = {
                            system_message:
                                typeof task?.spec?.payload?.system_message === 'string'
                                    ? task.spec.payload.system_message
                                    : '',
                            user_message:
                                typeof task?.spec?.payload?.user_message === 'string'
                                    ? task.spec.payload.user_message
                                    : '',
                        };
                        const stored = await putJson({
                            kind: 'prompt_template',
                            json: tpl,
                            relPath: `prompts/templates/${taskId}/${Date.now()}-${correlationId}.json`,
                            mime: 'application/json',
                        });
                        const artId = insertArtifact({
                            kind: 'prompt_template',
                            mime: stored.mime,
                            size_bytes: stored.sizeBytes,
                            sha256: stored.sha256,
                            storage_uri: stored.storageUri,
                            created_by: 'system',
                            created_at_ms: Date.now(),
                        });
                        this._safeUpdateTask(taskId, { prompt_template_artifact_id: artId });
                    }
                } catch (/** @type {any} */ _rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log('WARN', `[QueueWorker] Prompt template artifact storage failed for ${taskId}: ${err?.message}`);
                }

                // Render prompt for this attempt (supports optional context.inputs).
                const systemMessage =
                    typeof task?.spec?.payload?.system_message === 'string' ? task.spec.payload.system_message : '';
                const baseUserMessage =
                    typeof task?.spec?.payload?.user_message === 'string' ? task.spec.payload.user_message : '';
                const inputsAppend = await _resolveContextInputs(task?.spec?.payload?.context?.inputs, taskId);
                const renderedUserMessage = `${baseUserMessage}${inputsAppend}`;
                const driverPrompt = _composeDriverPrompt({ systemMessage, userMessage: renderedUserMessage });

                // Persist rendered prompt as artifact (attempt-scoped).
                let renderedPromptArtifactId = null;
                try {
                    const stored = await putText({
                        kind: 'prompt_rendered',
                        text: driverPrompt,
                        relPath: `prompts/rendered/${taskId}/${correlationId}.txt`,
                        ext: 'txt',
                        mime: 'text/plain',
                    });
                    renderedPromptArtifactId = insertArtifact({
                        kind: 'prompt_rendered',
                        mime: stored.mime,
                        size_bytes: stored.sizeBytes,
                        sha256: stored.sha256,
                        storage_uri: stored.storageUri,
                        created_by: 'system',
                        created_at_ms: Date.now(),
                    });
                    updateAttempt(correlationId, { rendered_prompt_artifact_id: renderedPromptArtifactId });
                    this._safeUpdateTask(taskId, {
                        latest_attempt_id: correlationId,
                        latest_rendered_prompt_artifact_id: renderedPromptArtifactId,
                    });
                } catch (/** @type {any} */ _rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log('WARN', `[QueueWorker] Rendered prompt artifact failed for ${taskId}: ${err?.message}`);
                    renderedPromptArtifactId = null;
                }

                // Hydrate runtime task: ensure the rendered user_message is what the driver will type.
                const runtimeTask = structuredClone(task);
                runtimeTask.spec = runtimeTask.spec || {};
                runtimeTask.spec.payload = runtimeTask.spec.payload || {};
                runtimeTask.spec.payload.user_message = renderedUserMessage;

                try {
                    await this.kernel.executeTask(runtimeTask, correlationId);
                } catch (/** @type {any} */ _rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    const msg = err?.message || String(err);
                    log('ERROR', `[QueueWorker] dispatch failed for ${taskId}: ${msg}`, correlationId);

                    const retryable = err?.retryable === true || err?.nextAction === 'RETRY_LATER';
                    const delayMs = Number(err?.delayMs ?? err?.suggestedDelayMs ?? 0) || 0;
                    const reason = err?.reason ? String(err.reason) : 'DISPATCH_FAILED';

                    // Attempt ended before driver start.
                    try {
                        updateAttempt(correlationId, {
                            status: 'FAILED',
                            ended_at_ms: Date.now(),
                            error: msg,
                        });
                    } catch (/** @type {any} */ _rawErr) {
                        const err = /** @type {any} */ (_rawErr);
                        log('WARN', `[QueueWorker] Attempt update failed for ${taskId}: ${err?.message}`);
                    }

                    if (retryable) {
                        const executeAfterMs = Date.now() + Math.max(250, delayMs || 1000);

                        this._safeUpdateTask(taskId, {
                            status: 'PENDING',
                            stage: TASK_STAGES.READY,
                            last_error: `DISPATCH_RETRY_SCHEDULED(${reason}): ${msg}`.slice(0, 2000),
                            execute_after_ms: executeAfterMs,
                        });

                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: Date.now(),
                            actorType: 'system',
                            eventType: 'TASK_RETRY_SCHEDULED',
                            payload: {
                                workerId: this.workerId,
                                correlationId,
                                reason,
                                delayMs: Math.max(250, delayMs || 1000),
                            },
                            dedupKey: `task:${taskId}:retry_scheduled:${correlationId}`,
                        });
                    } else {
                        this._safeUpdateTask(taskId, {
                            status: 'FAILED',
                            last_error: `DISPATCH_FAILED(${reason}): ${msg}`.slice(0, 2000),
                            failed_at_ms: Date.now(),
                        });

                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: Date.now(),
                            actorType: 'system',
                            eventType: 'TASK_DISPATCH_FAILED',
                            payload: { workerId: this.workerId, correlationId, reason },
                            dedupKey: `task:${taskId}:dispatch_failed:${correlationId}`,
                        });
                    }

                    releaseTaskLockForAttempt({
                        taskId,
                        attemptId: correlationId,
                        actionCode: 'QUEUE_DISPATCH_FAILED',
                        correlationId,
                        context: 'queue_dispatch_failed',
                    });
                }

                // Small yield to avoid monopolizing event loop when draining many slots.
                await _sleep(0);
            }
        } finally {
            this._running = false;
        }
    }
}

export { QueueWorker };
