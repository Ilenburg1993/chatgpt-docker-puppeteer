// @ts-check - Type checking rigoroso habilitado (arquivo core)
/**
 * Heartbeat Watchdog Worker (P1-10)
 *
 * Detecta e força falha de tasks que ficaram em RUNNING com heartbeat stale.
 * Resolve casos onde:
 * - Driver crashea sem enviar DRIVER_TASK_FAILED
 * - Network partition previne entrega de eventos NERV
 * - Deadlock no driver trava execução
 *
 * IMPLEMENTAÇÃO: aplica updateTask+updateAttempt+releaseTaskLock diretamente no DB.
 * Não usa recordEvent para "disparar" o projector — o projector escuta o NERV bus,
 * não a tabela de eventos, portanto essa abordagem anterior era inefetiva.
 */

import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { updateAttempt } from '#infra/db/task_attempt_repo';
import { releaseTaskLock, TASK_STAGES, updateTask } from '#infra/db/task_repo';

function _now() {
    return Date.now();
}

/**
 * @typedef {object} HeartbeatWatchdogConfig
 * @property {string|null} [workerId]
 * @property {number} [intervalMs]
 * @property {number} [staleThresholdMs]
 */

class HeartbeatWatchdog {
    /**
     * @param {HeartbeatWatchdogConfig} [config]
     */
    constructor({
        workerId = null,
        intervalMs = 60000, // Check every 1min
        staleThresholdMs = 180000, // 3min without heartbeat
    } = {}) {
        /** @type {string} */
        this.workerId = workerId ? String(workerId) : `watchdog-${process.pid}`;
        /** @type {number} */
        this.intervalMs = Math.max(10000, Number(intervalMs) || 60000);
        /** @type {number} */
        this.staleThresholdMs = Math.max(60000, Number(staleThresholdMs) || 180000);

        /** @type {NodeJS.Timeout|null} */
        this._timer = null;
        /** @type {boolean} */
        this._stopped = false;

        log(
            'INFO',
            `[HeartbeatWatchdog] initialized (interval=${this.intervalMs}ms, threshold=${this.staleThresholdMs}ms)`
        );
    }

    /**
     * Inicia o watchdog, começando a monitorar heartbeats de tarefas.
     * @returns {void}
     * @sideEffects Inicia timer interno e executa tick imediatamente.
     */
    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[HeartbeatWatchdog] started`);
    }

    /**
     * Para o watchdog, cancelando o timer de monitoramento.
     * @returns {void}
     * @sideEffects Cancela timer interno.
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[HeartbeatWatchdog] stopped');
    }

    /**
     * Executa um ciclo de monitoramento: detecta tentativas RUNNING com heartbeat stale
     * e força falha emitindo evento DRIVER_TASK_FAILED.
     * @returns {Promise<void>}
     * @throws {Error} Erros são logados mas não relançados.
     * @sideEffects Modifica estado do banco (status de attempts) e registra eventos.
     */
    async tick() {
        if (this._stopped) return;

        try {
            const now = _now();
            const staleThreshold = now - this.staleThresholdMs;

            const db = getDb();
            const staleAttempts = db
                .prepare(
                    `
                    SELECT
                        ta.id AS attempt_id,
                        ta.task_id,
                        ta.status,
                        ta.last_heartbeat_at_ms,
                        ta.created_at_ms,
                        t.status AS task_status,
                        t.locked_by,
                        t.lock_expires_at_ms
                    FROM task_attempts ta
                    LEFT JOIN tasks t ON t.id = ta.task_id
                    WHERE ta.status = 'RUNNING'
                      AND (ta.last_heartbeat_at_ms IS NULL OR ta.last_heartbeat_at_ms < @threshold)
                      AND ta.created_at_ms < @threshold
                    ORDER BY ta.last_heartbeat_at_ms ASC
                    LIMIT 50
                    `
                )
                .all({ threshold: staleThreshold });

            if (staleAttempts.length === 0) return;

            log('WARN', `[HeartbeatWatchdog] Found ${staleAttempts.length} stale running attempts`);

            for (const row of staleAttempts) {
                const taskId = String(row.task_id);
                const attemptId = String(row.attempt_id);
                const lastHeartbeat = Number(row.last_heartbeat_at_ms) || Number(row.created_at_ms);
                const staleDurationMs = now - lastHeartbeat;
                const errorMsg = `WATCHDOG: heartbeat timeout (${Math.floor(staleDurationMs / 1000)}s without heartbeat)`;

                // Stable dedupKey (no ${now}) — one event per (task, attempt), aligned with
                // AttemptWatchdog convention: watchdog:<reason>:<taskId>:<attemptId>.
                const dedupKey = `watchdog:heartbeat_timeout:${taskId}:${attemptId}`;
                const firstTime = recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'TASK_WATCHDOG_HEARTBEAT_TIMEOUT',
                    payload: {
                        task_id: taskId,
                        attempt_id: attemptId,
                        last_heartbeat_at_ms: lastHeartbeat,
                        stale_duration_ms: staleDurationMs,
                        threshold_ms: this.staleThresholdMs,
                        watchdog_worker_id: this.workerId,
                    },
                    dedupKey,
                });

                if (!firstTime) {
                    // Already processed this attempt — AttemptWatchdog or a previous tick handled it.
                    continue;
                }

                log(
                    'WARN',
                    `[HeartbeatWatchdog] Force-failing stale task (task_id=${taskId}, attempt_id=${attemptId}, stale_ms=${staleDurationMs})`
                );

                // BUG-HB-WATCHDOG: recordEvent(eventType=DRIVER_TASK_FAILED) was used previously,
                // but the TaskStateProjector listens to the NERV bus — not the events table — so the
                // old approach never caused a state transition. We now apply the state change directly
                // (same pattern as AttemptWatchdog) to actually unblock the task.

                // Close the stale attempt.
                try {
                    updateAttempt(attemptId, {
                        status: 'FAILED',
                        ended_at_ms: now,
                        error: errorMsg,
                        reason_class: 'ENV_UNAVAILABLE',
                        count_attempt: 0, // Don't consume retry budget for infrastructure failures
                        reason_code: 'HEARTBEAT_TIMEOUT',
                        cause_layer: 'WATCHDOG',
                    });
                } catch (attemptErr) {
                    log(
                        'WARN',
                        `[HeartbeatWatchdog] updateAttempt failed for ${attemptId}: ${attemptErr?.message || String(attemptErr)}`
                    );
                }

                // Reschedule the task for retry (only if task is in a non-terminal state).
                const taskStatus = String(row.task_status || '');
                if (taskStatus === 'RUNNING' || taskStatus === 'PENDING') {
                    try {
                        updateTask(taskId, {
                            stage: TASK_STAGES.READY,
                            status: 'PENDING',
                            execute_after_ms: now + 5000,
                            last_error: errorMsg,
                        });
                    } catch (taskErr) {
                        log(
                            'WARN',
                            `[HeartbeatWatchdog] updateTask failed for ${taskId}: ${taskErr?.message || String(taskErr)}`
                        );
                    }

                    try {
                        releaseTaskLock({ taskId });
                    } catch (lockErr) {
                        log(
                            'DEBUG',
                            `[HeartbeatWatchdog] lock release skipped for ${taskId}: ${lockErr?.message || String(lockErr)}`
                        );
                    }
                }

                log(
                    'INFO',
                    `[HeartbeatWatchdog] Task ${taskId} rescheduled after heartbeat timeout (attempt ${attemptId})`
                );
            }
        } catch (err) {
            log('ERROR', `[HeartbeatWatchdog] tick failed: ${err?.message || String(err)}`);
        }
    }
}

export { HeartbeatWatchdog };
