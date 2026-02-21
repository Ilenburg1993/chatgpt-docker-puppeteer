// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { releaseTaskLock } from '#infra/db/task_repo';
import { sendCommand } from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';

/**
 * Opções do construtor do TaskControlWatcher.
 * @typedef {Object} TaskControlWatcherOptions
 * @property {Object} nerv - Instância do sistema nerv para comunicação.
 * @property {number} [intervalMs=500] - Intervalo entre ticks em ms.
 */

/**
 * Watcher que monitora tarefas em estados de controle (PAUSED/CANCELLED) e emite comandos de abort.
 * Responsável por notificar drivers quando tarefas são canceladas ou pausadas pelo usuário.
 */
class TaskControlWatcher {
    /**
     * Cria um watcher para monitorar controles de tarefas.
     * @param {TaskControlWatcherOptions} options - Opções de configuração.
     */
    constructor(options) {
        const { nerv, intervalMs = 500 } = options;
        if (!nerv) {
            throw new Error('[TaskControlWatcher] nerv required');
        }
        this.nerv = nerv;
        this.intervalMs = Math.max(100, Number(intervalMs) || 500);
        this._timer = null;
        this._running = false;
        this._stopped = false;
        this.abortTimeoutMs = Math.max(100, Number(process.env.TASK_CONTROL_ABORT_TIMEOUT_MS || 1500) || 1500);
        this.abortMaxRetries = Math.max(0, Number.parseInt(process.env.TASK_CONTROL_ABORT_MAX_RETRIES || '2', 10) || 2);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _withTimeout(promise, timeoutMs, operation) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                const timeoutError = new Error(`${operation} timed out after ${timeoutMs}ms`);
                timeoutError.name = 'TimeoutError';
                reject(timeoutError);
            }, timeoutMs);

            Promise.resolve(promise).then(
                value => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                },
                error => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                }
            );
        });
    }

    async _emitAbortCommand(taskId, reason, correlationId) {
        const totalAttempts = this.abortMaxRetries + 1;
        let lastError = null;

        for (let attempt = 1; attempt <= totalAttempts; attempt++) {
            try {
                await this._withTimeout(
                    sendCommand(
                        this.nerv,
                        ActorRole.KERNEL,
                        ActionCode.DRIVER_ABORT,
                        { taskId, reason },
                        correlationId,
                        ActorRole.DRIVER
                    ),
                    this.abortTimeoutMs,
                    `sendCommand(DRIVER_ABORT:${taskId})`
                );

                return { ok: true, attempt };
            } catch (error) {
                lastError = error;
                log(
                    'WARN',
                    `[TaskControlWatcher] Abort emit attempt ${attempt}/${totalAttempts} falhou para ${taskId}: ${error?.message || String(error)}`,
                    correlationId
                );

                if (attempt < totalAttempts) {
                    await this._sleep(Math.min(250 * attempt, 750));
                }
            }
        }

        return {
            ok: false,
            attempts: totalAttempts,
            error: lastError?.message || String(lastError),
        };
    }

    /**
     * Inicia o watcher, começando a monitorar tarefas em estados de controle.
     * @returns {void}
     * @sideEffects Inicia timer interno e executa tick imediatamente.
     */
    /**
     * Inicia o watcher, começando a monitorar tarefas em estados de controle.
     * @returns {void}
     * @sideEffects Inicia timer interno e executa tick imediatamente.
     */
    start() {
        if (this._timer) return;
        this._stopped = false;
        this._timer = setInterval(() => {
            void this.tick();
        }, this.intervalMs);
        void this.tick();
        log('INFO', `[TaskControlWatcher] started (interval=${this.intervalMs}ms)`);
    }

    /**
     * Para o watcher, cancelando o timer de monitoramento.
     * @returns {void}
     * @sideEffects Cancela timer interno.
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[TaskControlWatcher] stopped');
    }

    /**
     * Executa um ciclo de monitoramento: busca tarefas PAUSED/CANCELLED com locks ativos
     * e emite comandos DRIVER_ABORT via nerv, liberando locks após.
     * @returns {Promise<void>}
     * @throws {Error} Erros são logados mas não relançados.
     * @sideEffects Modifica estado do banco (events, locks) e envia comandos via nerv.
     */
    async tick() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const db = getDb();
            const now = Date.now();

            // Only tasks that are in a control terminal state AND still claimed/locked might need a DRIVER_ABORT.
            const rows = db
                .prepare(
                    `
                    SELECT id, status, last_correlation_id, updated_at_ms, paused_at_ms, cancelled_at_ms
                    FROM tasks
                    WHERE status IN ('CANCELLED', 'PAUSED')
                      AND locked_by IS NOT NULL
                    ORDER BY updated_at_ms DESC
                    LIMIT 50
                `
                )
                .all();

            for (const row of rows) {
                const taskId = row?.id;
                if (!taskId) continue;

                const status = row?.status || 'CANCELLED';
                const correlationId = row?.last_correlation_id || `ctrl_${taskId}_${now}`;
                const reason = status === 'PAUSED' ? 'USER_PAUSED' : 'USER_CANCELLED';

                const intentAt =
                    status === 'PAUSED'
                        ? Number(row?.paused_at_ms || row?.updated_at_ms || now)
                        : Number(row?.cancelled_at_ms || row?.updated_at_ms || now);

                // Dedup per user intent (timestamped), not just per status, so pause→resume→pause emits again.
                const dedupKey = `ctrl:${taskId}:abort:${status}:${intentAt}`;
                const firstTime = recordEvent({
                    entityType: 'task',
                    entityId: taskId,
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'CONTROL_ABORT_INTENT',
                    payload: { reason, correlationId, status, intentAt },
                    dedupKey: `${dedupKey}:intent`,
                });

                if (!firstTime) {
                    continue;
                }

                const emitResult = await this._emitAbortCommand(taskId, reason, correlationId);
                const lockReason = emitResult.ok ? 'ABORT_EMITTED' : 'ABORT_EMIT_FAILED';
                let lockReleased = false;
                let lockReleaseError = null;

                // Hygiene: clear lock so the queue doesn't consider this task in-flight forever.
                try {
                    releaseTaskLock({ taskId });
                    lockReleased = true;
                } catch (_) {
                    lockReleaseError = _?.message || String(_);
                }

                if (emitResult.ok) {
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: Date.now(),
                        actorType: 'system',
                        eventType: 'CONTROL_ABORT_SENT',
                        payload: {
                            reason,
                            correlationId,
                            attempt: emitResult.attempt,
                            lockReleased,
                            lockReason,
                            lockReleaseError,
                        },
                        dedupKey: `${dedupKey}:sent`,
                    });
                } else {
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: Date.now(),
                        actorType: 'system',
                        eventType: 'CONTROL_ABORT_FAILED',
                        payload: {
                            reason,
                            correlationId,
                            attempts: emitResult.attempts,
                            error: emitResult.error,
                            lockReleased,
                            lockReason,
                            lockReleaseError,
                        },
                        dedupKey: `${dedupKey}:failed`,
                    });

                    log(
                        'WARN',
                        `[TaskControlWatcher] CONTROL_ABORT_FAILED para ${taskId} (lockReleased=${lockReleased}, reason=${lockReason})`,
                        correlationId
                    );
                }
            }
        } finally {
            this._running = false;
        }
    }
}

export { TaskControlWatcher };
