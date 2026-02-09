// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { ActionCode, ActorRole } from '#shared/nerv/constants';
import { sendCommand } from '#nerv/adapters/high_level_adapter';
import { getDb } from '#infra/db/sqlite';
import { recordEvent } from '#infra/db/events_repo';
import { releaseTaskLock } from '#infra/db/task_repo';

class TaskControlWatcher {
    constructor({ nerv, intervalMs = 500 } = {}) {
        if (!nerv) {
            throw new Error('[TaskControlWatcher] nerv required');
        }
        this.nerv = nerv;
        this.intervalMs = Math.max(100, Number(intervalMs) || 500);
        this._timer = null;
        this._running = false;
        this._stopped = false;
    }

    start() {
        if (this._timer) return;
        this._stopped = false;
        this._timer = setInterval(() => {
            void this.tick();
        }, this.intervalMs);
        void this.tick();
        log('INFO', `[TaskControlWatcher] started (interval=${this.intervalMs}ms)`);
    }

    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[TaskControlWatcher] stopped');
    }

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
                    eventType: 'CONTROL_ABORT_SENT',
                    payload: { reason, correlationId },
                    dedupKey,
                });

                if (!firstTime) {
                    continue;
                }

                try {
                    sendCommand(
                        this.nerv,
                        ActorRole.KERNEL,
                        ActionCode.DRIVER_ABORT,
                        { taskId, reason },
                        correlationId,
                        ActorRole.DRIVER
                    );
                } catch (err) {
                    log('WARN', `[TaskControlWatcher] Failed to emit DRIVER_ABORT for ${taskId}: ${err?.message || String(err)}`, correlationId);
                }

                // Hygiene: clear lock so the queue doesn't consider this task in-flight forever.
                try {
                    releaseTaskLock({ taskId });
                } catch (_) {
                    /* ignore */
                }
            }
        } finally {
            this._running = false;
        }
    }
}

export { TaskControlWatcher };
