// @ts-check
import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';
import { taskRowToListItem } from '../api/utils/task_views.js';

let _timer = null;
let _running = false;
let _stopped = false;
let _lastEventId = null;
let _lastErrorLogAtMs = 0;
let _errorCount = 0;

/**
 * @typedef {object} TickOptions
 * @property {object} socketHub - Instância do SocketHub para emissão de eventos
 * @property {number} [batchLimit=500] - Número máximo de eventos por lote
 */

/**
 * @typedef {object} StartOptions
 * @property {object} socketHub - Instância do SocketHub para emissão de eventos
 * @property {number} [intervalMs=250] - Intervalo em ms entre verificações
 * @property {number} [batchLimit=500] - Número máximo de eventos por lote
 */

function _asInt(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function _fetchMissionCounts(db, missionIds) {
    if (!missionIds || missionIds.length === 0) return {};
    const placeholders = missionIds.map(() => '?').join(',');

    const rows = db
        .prepare(
            `
            SELECT mission_id, stage, status, COUNT(*) AS c
            FROM tasks
            WHERE mission_id IN (${placeholders})
            GROUP BY mission_id, stage, status
        `
        )
        .all(...missionIds);

    /** @type {Record<string, any>} */
    const out = {};
    for (const r of rows) {
        const mid = String(r.mission_id);
        out[mid] = out[mid] || { tasks_total: 0, by_stage: {}, by_status: {}, proposed: 0, blocked: 0, running: 0, pending: 0, done: 0, failed: 0 };
        const c = Number(r.c) || 0;
        out[mid].tasks_total += c;
        out[mid].by_stage[String(r.stage)] = (out[mid].by_stage[String(r.stage)] || 0) + c;
        out[mid].by_status[String(r.status)] = (out[mid].by_status[String(r.status)] || 0) + c;
        if (String(r.stage) === 'PROPOSED') out[mid].proposed += c;
        if (String(r.status) === 'BLOCKED') out[mid].blocked += c;
        if (String(r.status) === 'RUNNING') out[mid].running += c;
        if (String(r.status) === 'PENDING') out[mid].pending += c;
        if (String(r.status) === 'DONE') out[mid].done += c;
        if (String(r.status) === 'FAILED') out[mid].failed += c;
    }
    return out;
}

function _safeParsePayloadJson(raw) {
    try {
        return raw ? JSON.parse(String(raw)) : {};
    } catch (_) {
        return raw ?? {};
    }
}

function _getInitialLastEventId(db, { fromStart = false } = {}) {
    if (fromStart) return 0;
    try {
        return Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get()?.id) || 0;
    } catch (_) {
        return 0;
    }
}

/**
 * Executa um ciclo de polling de eventos SSOT e os emite via Socket.io.
 * Busca novos eventos no banco de dados e os envia para clientes conectados.
 *
 * @param {TickOptions} options - Opções do ciclo de polling
 * @returns {Promise<void>}
 * @sideEffects - Emite eventos 'ssot:events_batch' e 'mission:updates_batch' via Socket.io
 */
async function _tick(options) {
    const { socketHub, batchLimit = 500 } = options || {};
    if (_stopped) return;
    if (_running) return;
    _running = true;

    try {
        const io = socketHub?.getIO?.();
        if (!io) {
            return;
        }

        const db = getDb();
        if (_lastEventId === null) {
            _lastEventId = _getInitialLastEventId(db, { fromStart: process.env.SSOT_EVENT_FEED_FROM_START === 'true' });
        }

        const events = db
            .prepare(
                `
                SELECT *
                FROM events
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
            `
            )
            .all(_lastEventId, Math.max(1, Math.min(Number(batchLimit) || 500, 2000)));

        if (!events || events.length === 0) {
            return;
        }

        const lastId = Number(events[events.length - 1]?.id) || _lastEventId;
        _lastEventId = lastId;

        /** @type {Set<string>} */
        const taskIds = new Set();
        /** @type {Set<string>} */
        const missionIds = new Set();

        for (const e of events) {
            if (e.entity_type === 'task') taskIds.add(String(e.entity_id));
            if (e.entity_type === 'mission') missionIds.add(String(e.entity_id));
        }

        const normalizedEvents = events.map(e => ({
            id: e.id,
            entity_type: e.entity_type,
            entity_id: e.entity_id,
            ts_ms: e.ts_ms,
            actor_type: e.actor_type,
            actor_id: e.actor_id,
            event_type: e.event_type,
            payload: _safeParsePayloadJson(e.payload_json),
        }));

        io.to('dashboards').emit('ssot:events_batch', {
            events: normalizedEvents,
            count: normalizedEvents.length,
            last_event_id: lastId,
        });

        // Tasks snapshots (TaskListItem)
        if (taskIds.size > 0) {
            const ids = Array.from(taskIds);
            const placeholders = ids.map(() => '?').join(',');
            const rows = db
                .prepare(
                    `
                    SELECT
                        id, mission_id, parent_id, workflow_id,
                        stage, status,
                        priority, target, model,
                        execute_after_ms, attempts,
                        locked_by, lock_expires_at_ms,
                        blocked_reason, blocked_at_ms,
                        latest_attempt_id,
                        spec_user_message, spec_system_message,
                        task_json,
                        created_at_ms, updated_at_ms,
                        started_at_ms, completed_at_ms, failed_at_ms, paused_at_ms, cancelled_at_ms
                    FROM tasks
                    WHERE id IN (${placeholders})
                `
                )
                .all(...ids);

            const updates = rows.map(r => {
                const task = taskRowToListItem(r);
                return {
                    taskId: r.id,
                    task,
                    // Legacy compatibility: keep a minimal `state` for consumers that only
                    // care about status transitions.
                    state: { status: task.unified_status },
                };
            });

            if (updates.length > 0) {
                io.to('dashboards').emit('task:updates_batch', {
                    updates,
                    count: updates.length,
                    last_event_id: lastId,
                });
                for (const u of updates) {
                    io.to('dashboards').emit('task:updated', u);
                }
            }
        }

        // Missions snapshots (MissionListItem-ish + counts)
        if (missionIds.size > 0) {
            const ids = Array.from(missionIds);
            const placeholders = ids.map(() => '?').join(',');
            const rows = db
                .prepare(
                    `
                    SELECT *
                    FROM missions
                    WHERE id IN (${placeholders})
                `
                )
                .all(...ids);

            const counts = _fetchMissionCounts(db, ids);
            const updates = rows.map(r => ({
                missionId: r.id,
                mission: {
                    id: r.id,
                    title: r.title,
                    description: r.description,
                    status: r.status,
                    autonomy_mode: r.autonomy_mode,
                    created_at_ms: r.created_at_ms,
                    updated_at_ms: r.updated_at_ms,
                    started_at_ms: r.started_at_ms ?? null,
                    completed_at_ms: r.completed_at_ms ?? null,
                    counts: counts[String(r.id)] || null,
                },
            }));

            if (updates.length > 0) {
                io.to('dashboards').emit('mission:updates_batch', {
                    updates,
                    count: updates.length,
                    last_event_id: lastId,
                });
                for (const u of updates) {
                    io.to('dashboards').emit('mission:updated', u);
                }
            }
        }
    } catch (err) {
        _errorCount += 1;
        const now = Date.now();
        const minIntervalMs = 5000;
        if (now - _lastErrorLogAtMs >= minIntervalMs) {
            _lastErrorLogAtMs = now;
            log('ERROR', `[SSOTEventFeed] tick failed (count=${_errorCount}): ${err?.message || String(err)}`);
        }
    } finally {
        _running = false;
    }
}

/**
 * Inicia o feed de eventos SSOT (Single Source of Truth) em tempo real.
 * Monitora mudanças no banco de dados SQLite e emite eventos via Socket.io para dashboards conectados.
 *
 * @param {StartOptions} options - Opções de configuração do feed
 * @throws {Error} Se socketHub não for fornecido
 * @sideEffects - Inicia timer de polling, registra listeners de Socket.io, emite eventos 'ssot:events_batch' e 'mission:updates_batch'
 * @returns {void}
 */
function start(options) {
    const { socketHub, intervalMs = 250, batchLimit = 500 } = options || {};
    if (_timer) return;
    if (!socketHub) throw new Error('SSOTEventFeed.start requires socketHub');

    const enabled = process.env.SSOT_EVENT_FEED_ENABLED !== 'false';
    if (!enabled) {
        log('INFO', '[SSOTEventFeed] disabled (SSOT_EVENT_FEED_ENABLED=false)');
        return;
    }

    _stopped = false;
    _lastEventId = null;

    const interval = Math.max(50, _asInt(intervalMs, 250));
    const lim = Math.max(10, Math.min(_asInt(batchLimit, 500), 2000));

    _timer = setInterval(() => {
        void _tick({ socketHub, batchLimit: lim }).catch(err => {
            _errorCount += 1;
            const now = Date.now();
            const minIntervalMs = 5000;
            if (now - _lastErrorLogAtMs >= minIntervalMs) {
                _lastErrorLogAtMs = now;
                log('ERROR', `[SSOTEventFeed] tick unhandled error (count=${_errorCount}): ${err?.message || String(err)}`);
            }
        });
    }, interval);
    void _tick({ socketHub, batchLimit: lim });

    log('INFO', `[SSOTEventFeed] started (interval=${interval}ms, batchLimit=${lim})`);
}

/**
 * Para o feed de eventos SSOT e limpa todos os recursos associados.
 * Interrompe o polling de eventos, cancela timers e marca o feed como parado.
 *
 * @sideEffects - Cancela timer de polling, limpa estado interno, emite log de parada
 * @returns {void}
 */
function stop() {
    _stopped = true;
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    _running = false;
    log('INFO', '[SSOTEventFeed] stopped');
}

export { start, stop };
