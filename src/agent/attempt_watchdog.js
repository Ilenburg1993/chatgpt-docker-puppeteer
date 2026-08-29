// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { updateAttempt } from '#infra/db/task_attempt_repo';
import { releaseTaskLock, TASK_STAGES, updateTask } from '#infra/db/task_repo';
import { sendCommand } from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';

/** @param {any} ms */
function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opções do construtor do AttemptWatchdog.
 *
 * @typedef {object} AttemptWatchdogOptions
 * @property {object | null} [nerv] - Instância do sistema nerv para comunicação.
 * @property {number} [intervalMs=1500] - Intervalo entre ticks em ms. Default is `1500`
 * @property {number} [dispatchedStuckMs=30000] - Timeout para estado DISPATCHED em ms. Default is `30000`
 * @property {number} [acceptedStuckMs=120000] - Timeout para estado ACCEPTED em ms. Default is `120000`
 * @property {number} [runningHeartbeatStuckMs=30000] - Timeout para heartbeats em RUNNING em ms. Default is `30000`
 * @property {number} [rescheduleDelayMs=1000] - Delay para reagendamento em ms. Default is `1000`
 * @property {number} [envEscalationWindowMs=900000] - Janela para escalação de ambiente em ms. Default is `900000`
 * @property {number} [envEscalationThreshold=10] - Threshold para escalação de ambiente. Default is `10`
 * @property {number} [llmTimeoutEscalationWindowMs=1800000] - Janela para escalação de timeout LLM em ms. Default is
 *   `1800000`
 * @property {number} [llmTimeoutEscalationThreshold=10] - Threshold para escalação de timeout LLM. Default is `10`
 * @property {number} [maxBatch=25] - Máximo de tarefas por lote. Default is `25`
 */

/**
 * Watchdog que monitora tentativas de tarefas e detecta timeouts ou falhas. Responsável por escalar tarefas stuck e
 * manter saúde do sistema.
 */
class AttemptWatchdog {
    /**
     * Cria um watchdog para monitorar tentativas de tarefas.
     *
     * @param {AttemptWatchdogOptions} [options={}] - Opções de configuração. Default is `{}`
     */
    constructor({
        nerv = null,
        intervalMs = 1500,
        dispatchedStuckMs = 30000,
        acceptedStuckMs = 120000,
        runningHeartbeatStuckMs = 30000,
        rescheduleDelayMs = 1000,
        envEscalationWindowMs = 15 * 60 * 1000,
        envEscalationThreshold = 10,
        llmTimeoutEscalationWindowMs = 30 * 60 * 1000,
        llmTimeoutEscalationThreshold = 10,
        maxBatch = 25,
    } = {}) {
        this.nerv = nerv || null;
        this.intervalMs = Math.max(250, Number(intervalMs) || 1500);
        this.dispatchedStuckMs = Math.max(5000, Number(dispatchedStuckMs) || 30000);
        this.acceptedStuckMs = Math.max(10000, Number(acceptedStuckMs) || 120000);
        this.runningHeartbeatStuckMs = Math.max(10000, Number(runningHeartbeatStuckMs) || 30000);
        this.rescheduleDelayMs = Math.max(250, Number(rescheduleDelayMs) || 1000);
        this.envEscalationWindowMs = Math.max(60_000, Number(envEscalationWindowMs) || 15 * 60 * 1000);
        this.envEscalationThreshold = Math.max(1, Number(envEscalationThreshold) || 10);
        this.llmTimeoutEscalationWindowMs = Math.max(60_000, Number(llmTimeoutEscalationWindowMs) || 30 * 60 * 1000);
        this.llmTimeoutEscalationThreshold = Math.max(1, Number(llmTimeoutEscalationThreshold) || 10);
        this.maxBatch = Math.max(1, Math.min(Number(maxBatch) || 25, 250));

        this._running = false;
        this._stopped = false;
        this._timer = null;
    }

    /**
     * Inicia o watchdog, começando a monitorar tentativas de tarefas.
     *
     * @returns {void}
     * @sideEffects Inicia timer interno e executa tick imediatamente.
     */
    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[AttemptWatchdog] started (interval=${this.intervalMs}ms)`);
    }

    /**
     * Para o watchdog, cancelando o timer de monitoramento.
     *
     * @returns {void}
     * @sideEffects Cancela timer interno.
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[AttemptWatchdog] stopped');
    }

    /**
     * Executa um ciclo de monitoramento: detecta tentativas stuck e as escalona. Verifica timeouts para estados
     * DISPATCHED, ACCEPTED e heartbeats em RUNNING.
     *
     * @returns {Promise<void>}
     * @throws {Error} Erros são logados mas não relançados.
     * @sideEffects Modifica estado do banco (status, locks) e envia comandos via nerv.
     */
    async tick() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const db = getDb();
            const now = Date.now();
            const cutoff = now - this.dispatchedStuckMs;
            const acceptedCutoff = now - this.acceptedStuckMs;
            const runningCutoff = now - this.runningHeartbeatStuckMs;

            const dispatchedRows = /** @type {any[]} */ (
                db
                    .prepare(
                        `
                    SELECT t.id AS task_id,
                           t.latest_attempt_id AS attempt_id,
                           a.created_at_ms AS attempt_created_at_ms,
                           a.last_heartbeat_at_ms AS last_heartbeat_at_ms
                    FROM tasks t
                    JOIN task_attempts a ON a.id = t.latest_attempt_id
                    WHERE t.stage = 'READY'
                      AND t.status = 'PENDING'
                      AND t.locked_by IS NOT NULL
                      AND t.lock_expires_at_ms IS NOT NULL
                      AND t.lock_expires_at_ms > @now
                      AND a.status = 'DISPATCHED'
                      AND a.ended_at_ms IS NULL
                      AND (a.last_heartbeat_at_ms IS NULL AND a.created_at_ms <= @cutoff)
                    ORDER BY a.created_at_ms ASC
                    LIMIT @limit
                `,
                    )
                    .all({ now, cutoff, limit: this.maxBatch })
            );

            const acceptedRows = /** @type {any[]} */ (
                db
                    .prepare(
                        `
                    SELECT t.id AS task_id,
                           t.latest_attempt_id AS attempt_id,
                           a.created_at_ms AS attempt_created_at_ms,
                           a.started_at_ms AS started_at_ms,
                           a.last_heartbeat_at_ms AS last_heartbeat_at_ms
                    FROM tasks t
                    JOIN task_attempts a ON a.id = t.latest_attempt_id
                    WHERE t.stage = 'READY'
                      AND t.status = 'PENDING'
                      AND t.locked_by IS NOT NULL
                      AND t.lock_expires_at_ms IS NOT NULL
                      AND t.lock_expires_at_ms > @now
                      AND a.status = 'DISPATCHED'
                      AND a.ended_at_ms IS NULL
                      AND a.started_at_ms IS NULL
                      AND a.last_heartbeat_at_ms IS NOT NULL
                      AND a.last_heartbeat_at_ms <= @acceptedCutoff
                    ORDER BY a.last_heartbeat_at_ms ASC
                    LIMIT @limit
                `,
                    )
                    .all({ now, acceptedCutoff, limit: this.maxBatch })
            );

            const runningRows = /** @type {any[]} */ (
                db
                    .prepare(
                        `
                    SELECT t.id AS task_id,
                           t.latest_attempt_id AS attempt_id,
                           a.last_heartbeat_at_ms AS last_heartbeat_at_ms
                    FROM tasks t
                    JOIN task_attempts a ON a.id = t.latest_attempt_id
                    WHERE t.stage = 'READY'
                      AND t.status = 'RUNNING'
                      AND t.locked_by IS NOT NULL
                      AND t.lock_expires_at_ms IS NOT NULL
                      AND t.lock_expires_at_ms > @now
                      AND a.status = 'RUNNING'
                      AND a.ended_at_ms IS NULL
                      AND (
                          (a.last_heartbeat_at_ms IS NOT NULL AND a.last_heartbeat_at_ms <= @runningCutoff)
                          OR (a.last_heartbeat_at_ms IS NULL AND a.created_at_ms <= @runningCutoff)
                      )
                    ORDER BY COALESCE(a.last_heartbeat_at_ms, a.created_at_ms) ASC
                    LIMIT @limit
                `,
                    )
                    .all({ now, runningCutoff, limit: this.maxBatch })
            );

            for (const row of dispatchedRows) {
                const taskId = row?.task_id;
                const attemptId = row?.attempt_id;
                if (!taskId || !attemptId) continue;

                const dedupKey = `watchdog:attempt_stuck_dispatched:${taskId}:${attemptId}`;
                const firstTime = recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'TASK_WATCHDOG_RESCHEDULED',
                    payload: { attemptId, reason: 'ATTEMPT_STUCK_DISPATCHED' },
                    dedupKey,
                });
                if (!firstTime) continue;

                try {
                    updateAttempt(attemptId, {
                        status: 'FAILED',
                        ended_at_ms: now,
                        error: 'WATCHDOG: stuck in DISPATCHED without driver response',
                    });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                try {
                    updateTask(taskId, {
                        stage: TASK_STAGES.READY,
                        status: 'PENDING',
                        execute_after_ms: now + this.rescheduleDelayMs,
                        last_error: 'ATTEMPT_STUCK_DISPATCHED',
                    });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                try {
                    releaseTaskLock({ taskId });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                await _sleep(0);
            }

            for (const row of acceptedRows) {
                const taskId = row?.task_id;
                const attemptId = row?.attempt_id;
                if (!taskId || !attemptId) continue;

                const dedupKey = `watchdog:attempt_stuck_accepted:${taskId}:${attemptId}`;
                const firstTime = recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'TASK_WATCHDOG_RESCHEDULED',
                    payload: { attemptId, reason: 'ATTEMPT_STUCK_ACCEPTED_NO_START' },
                    dedupKey,
                });
                if (!firstTime) continue;

                try {
                    updateAttempt(attemptId, {
                        status: 'FAILED',
                        ended_at_ms: now,
                        error: 'WATCHDOG: accepted/heartbeat seen but never STARTED',
                        reason_class: 'ENV_UNAVAILABLE',
                        count_attempt: 0,
                    });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                try {
                    updateTask(taskId, {
                        stage: TASK_STAGES.READY,
                        status: 'PENDING',
                        execute_after_ms: now + this.rescheduleDelayMs,
                        last_error: 'ATTEMPT_STUCK_ACCEPTED_NO_START',
                    });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                try {
                    releaseTaskLock({ taskId });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                await _sleep(0);
            }

            for (const row of runningRows) {
                const taskId = row?.task_id;
                const attemptId = row?.attempt_id;
                if (!taskId || !attemptId) continue;

                const dedupKey = `watchdog:attempt_stuck_running:${taskId}:${attemptId}`;
                const firstTime = recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'TASK_WATCHDOG_RESCHEDULED',
                    payload: { attemptId, reason: 'ATTEMPT_STUCK_RUNNING_NO_HEARTBEAT' },
                    dedupKey,
                });
                if (!firstTime) continue;

                // Best-effort abort to stop runaway driver execution (if still alive).
                try {
                    if (this.nerv) {
                        // oxlint-disable-next-line typescript/await-thenable
                        await sendCommand(
                            this.nerv,
                            ActorRole.KERNEL,
                            ActionCode.DRIVER_ABORT,
                            { taskId, reason: 'WATCHDOG_HEARTBEAT_TIMEOUT' },
                            attemptId,
                            ActorRole.DRIVER,
                        );
                    }
                } catch (/** @type {any} */ _rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'WARN',
                        `[AttemptWatchdog] Failed to emit DRIVER_ABORT for ${taskId}: ${err?.message || String(err)}`,
                        attemptId,
                    );
                }

                try {
                    updateAttempt(attemptId, {
                        status: 'FAILED',
                        ended_at_ms: now,
                        error: 'WATCHDOG: running without heartbeat',
                        reason_class: 'ENV_UNAVAILABLE',
                        count_attempt: 0,
                    });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                try {
                    updateTask(taskId, {
                        stage: TASK_STAGES.READY,
                        status: 'PENDING',
                        execute_after_ms: now + this.rescheduleDelayMs,
                        last_error: 'ATTEMPT_STUCK_RUNNING_NO_HEARTBEAT',
                    });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                try {
                    releaseTaskLock({ taskId });
                } catch (/** @type {any} */ _) {
                    /* ignore */
                }

                await _sleep(0);
            }

            // Escalation: repeated ENV_UNAVAILABLE / LLM_TIMEOUT should become BLOCKED (explicit SSOT state)
            // to avoid churn and make required action clear in the dashboard.
            try {
                const envCutoff = now - this.envEscalationWindowMs;
                const llmCutoff = now - this.llmTimeoutEscalationWindowMs;

                const envLongRows = /** @type {any[]} */ (
                    db
                        .prepare(
                            `
                        SELECT t.id AS task_id,
                               COUNT(1) AS c,
                               MAX(a.ended_at_ms) AS last_ts,
                               (
                                   SELECT aa.reason_code
                                   FROM task_attempts aa
                                   WHERE aa.task_id = t.id
                                     AND aa.reason_class = 'ENV_UNAVAILABLE'
                                     AND aa.ended_at_ms IS NOT NULL
                                     AND aa.ended_at_ms >= @cutoff
                                   ORDER BY aa.ended_at_ms DESC
                                   LIMIT 1
                               ) AS last_reason_code,
                               (
                                   SELECT aa.error
                                   FROM task_attempts aa
                                   WHERE aa.task_id = t.id
                                     AND aa.reason_class = 'ENV_UNAVAILABLE'
                                     AND aa.ended_at_ms IS NOT NULL
                                     AND aa.ended_at_ms >= @cutoff
                                   ORDER BY aa.ended_at_ms DESC
                                   LIMIT 1
                               ) AS last_error
                        FROM tasks t
                        JOIN task_attempts a ON a.task_id = t.id
                        WHERE t.stage = 'READY'
                          AND t.status = 'PENDING'
                          AND (t.blocked_reason IS NULL OR t.blocked_reason = '')
                          AND (t.locked_by IS NULL OR t.lock_expires_at_ms IS NULL OR t.lock_expires_at_ms <= @now)
                          AND a.reason_class = 'ENV_UNAVAILABLE'
                          AND a.ended_at_ms IS NOT NULL
                          AND a.ended_at_ms >= @cutoff
                        GROUP BY t.id
                        HAVING COUNT(1) >= @threshold
                        ORDER BY last_ts DESC
                        LIMIT @limit
                    `,
                        )
                        .all({
                            now,
                            cutoff: envCutoff,
                            threshold: this.envEscalationThreshold,
                            limit: this.maxBatch,
                        })
                );

                const llmTimeoutRows = /** @type {any[]} */ (
                    db
                        .prepare(
                            `
                        SELECT t.id AS task_id,
                               COUNT(1) AS c,
                               MAX(a.ended_at_ms) AS last_ts,
                               (
                                   SELECT aa.error
                                   FROM task_attempts aa
                                   WHERE aa.task_id = t.id
                                     AND aa.reason_code = 'LLM_TIMEOUT'
                                     AND aa.ended_at_ms IS NOT NULL
                                     AND aa.ended_at_ms >= @cutoff
                                   ORDER BY aa.ended_at_ms DESC
                                   LIMIT 1
                               ) AS last_error
                        FROM tasks t
                        JOIN task_attempts a ON a.task_id = t.id
                        WHERE t.stage = 'READY'
                          AND t.status = 'PENDING'
                          AND (t.blocked_reason IS NULL OR t.blocked_reason = '')
                          AND (t.locked_by IS NULL OR t.lock_expires_at_ms IS NULL OR t.lock_expires_at_ms <= @now)
                          AND a.reason_code = 'LLM_TIMEOUT'
                          AND a.ended_at_ms IS NOT NULL
                          AND a.ended_at_ms >= @cutoff
                        GROUP BY t.id
                        HAVING COUNT(1) >= @threshold
                        ORDER BY last_ts DESC
                        LIMIT @limit
                    `,
                        )
                        .all({
                            now,
                            cutoff: llmCutoff,
                            threshold: this.llmTimeoutEscalationThreshold,
                            limit: this.maxBatch,
                        })
                );

                for (const row of envLongRows) {
                    const taskId = row?.task_id;
                    if (!taskId) continue;

                    const lastTs = Number(row?.last_ts) || now;
                    const dedupKey = `watchdog:block_env_unavailable_long:${taskId}:${lastTs}`;
                    const firstTime = recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: now,
                        actorType: 'system',
                        eventType: 'TASK_WATCHDOG_BLOCKED',
                        payload: {
                            reason: 'ENV_UNAVAILABLE_LONG',
                            windowMs: this.envEscalationWindowMs,
                            threshold: this.envEscalationThreshold,
                            count: Number(row?.c) || 0,
                            last_reason_code: row?.last_reason_code || null,
                            last_error: row?.last_error || null,
                        },
                        dedupKey,
                    });
                    if (!firstTime) continue;

                    try {
                        updateTask(taskId, {
                            stage: TASK_STAGES.READY,
                            status: 'BLOCKED',
                            blocked_reason: 'ENV_UNAVAILABLE_LONG',
                            blocked_at_ms: now,
                            blocked_details_json: JSON.stringify({
                                window_ms: this.envEscalationWindowMs,
                                threshold: this.envEscalationThreshold,
                                count: Number(row?.c) || 0,
                                last_attempt_at_ms: lastTs,
                                last_reason_code: row?.last_reason_code || null,
                                last_error: row?.last_error || null,
                            }),
                            execute_after_ms: null,
                            last_error: String(row?.last_error || 'ENV_UNAVAILABLE_LONG').slice(0, 2000),
                        });
                    } catch (/** @type {any} */ _) {
                        /* ignore */
                    }

                    try {
                        releaseTaskLock({ taskId });
                    } catch (/** @type {any} */ _) {
                        /* ignore */
                    }

                    await _sleep(0);
                }

                for (const row of llmTimeoutRows) {
                    const taskId = row?.task_id;
                    if (!taskId) continue;

                    const lastTs = Number(row?.last_ts) || now;
                    const dedupKey = `watchdog:block_llm_timeout_persistent:${taskId}:${lastTs}`;
                    const firstTime = recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: now,
                        actorType: 'system',
                        eventType: 'TASK_WATCHDOG_BLOCKED',
                        payload: {
                            reason: 'LLM_TIMEOUT_PERSISTENT',
                            windowMs: this.llmTimeoutEscalationWindowMs,
                            threshold: this.llmTimeoutEscalationThreshold,
                            count: Number(row?.c) || 0,
                            last_error: row?.last_error || null,
                        },
                        dedupKey,
                    });
                    if (!firstTime) continue;

                    try {
                        updateTask(taskId, {
                            stage: TASK_STAGES.READY,
                            status: 'BLOCKED',
                            blocked_reason: 'LLM_TIMEOUT_PERSISTENT',
                            blocked_at_ms: now,
                            blocked_details_json: JSON.stringify({
                                window_ms: this.llmTimeoutEscalationWindowMs,
                                threshold: this.llmTimeoutEscalationThreshold,
                                count: Number(row?.c) || 0,
                                last_attempt_at_ms: lastTs,
                                last_error: row?.last_error || null,
                            }),
                            execute_after_ms: null,
                            last_error: String(row?.last_error || 'LLM_TIMEOUT_PERSISTENT').slice(0, 2000),
                        });
                    } catch (/** @type {any} */ _) {
                        /* ignore */
                    }

                    try {
                        releaseTaskLock({ taskId });
                    } catch (/** @type {any} */ _) {
                        /* ignore */
                    }

                    await _sleep(0);
                }
            } catch (/** @type {any} */ _) {
                /* ignore escalation errors */
            }
        } finally {
            this._running = false;
        }
    }
}

export { AttemptWatchdog };
