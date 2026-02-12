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
 * Mitigation: Query periódica de attempts com status=RUNNING e heartbeat > threshold,
 * emitindo DRIVER_TASK_FAILED para forçar transição via projector.
 */

import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { ActionCode } from '#shared/nerv/constants';

function _now() {
    return Date.now();
}

/**
 * @typedef {Object} HeartbeatWatchdogConfig
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

                log(
                    'WARN',
                    `[HeartbeatWatchdog] Force-failing stale task (task_id=${taskId}, attempt_id=${attemptId}, stale_ms=${staleDurationMs})`
                );

                // Emit synthetic DRIVER_TASK_FAILED event to trigger state transition via projector.
                // Use ENV_UNAVAILABLE reason_class to avoid consuming retry budget.
                const inserted = recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: ActionCode.DRIVER_TASK_FAILED,
                    payload: {
                        task_id: taskId,
                        correlation_id: attemptId, // Use attempt ID as correlation to route to correct attempt
                        reason_class: 'ENV_UNAVAILABLE',
                        reason_code: 'HEARTBEAT_TIMEOUT',
                        cause_layer: 'WATCHDOG',
                        reason: `Driver heartbeat timeout (${Math.floor(staleDurationMs / 1000)}s without heartbeat)`,
                        retryable: true,
                        count_attempt: false, // Don't consume retry budget for infrastructure failures
                        details: {
                            last_heartbeat_at_ms: lastHeartbeat,
                            stale_duration_ms: staleDurationMs,
                            threshold_ms: this.staleThresholdMs,
                            watchdog_worker_id: this.workerId,
                        },
                    },
                    dedupKey: `watchdog:${taskId}:${attemptId}:heartbeat_timeout:${now}`,
                });

                if (inserted) {
                    log(
                        'INFO',
                        `[HeartbeatWatchdog] Emitted DRIVER_TASK_FAILED for task ${taskId} (attempt ${attemptId})`
                    );
                } else {
                    log('WARN', `[HeartbeatWatchdog] Failed to emit event for task ${taskId} (dedup or error)`);
                }
            }
        } catch (err) {
            log('ERROR', `[HeartbeatWatchdog] tick failed: ${err?.message || String(err)}`);
        }
    }
}

export { HeartbeatWatchdog };
