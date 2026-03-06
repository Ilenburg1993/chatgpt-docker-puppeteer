// @ts-check - Type checking rigoroso habilitado (arquivo core)
import CONFIG from '#core/config';
import {
    emitStaleAttemptIgnoredEvent,
    evaluateAttemptInvariants,
    releaseTaskLockForAttempt,
} from '#agent/task_attempt_invariants';
import { log } from '#core/logger';
import { insertArtifact } from '#infra/db/artifact_repo';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { updateAttempt, upsertAttempt } from '#infra/db/task_attempt_repo';
import { extendTaskLock, incrementTaskAttempts, TASK_STAGES, updateTask } from '#infra/db/task_repo';
import * as PATHS from '#infra/fs/paths';
import { ActionCode, MessageType } from '#shared/nerv/constants';
import {
    getActionCode,
    getCorrelationId,
    getMessageType,
    getMsgId,
    getPayload,
    getTaskIdFromPayload,
} from '#shared/nerv/envelope_reader';
import { asRecord } from '#types/guards';
import fs from 'node:fs';
import path from 'node:path';

/** @param {any} payload @returns {any} */
function _safeDelayMs(payload) {
    const raw =
        payload?.suggestedDelayMs ?? payload?.retryDelayMs ?? payload?.retry_delay_ms ?? payload?.delayMs ?? null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** @param {any} taskId @returns {any} */
function _storagePointers(taskId) {
    const artifactsRoot = path.resolve(
        process.env.MAESTRO_ARTIFACTS_DIR || process.env.ARTIFACTS_DIR || PATHS.ARTIFACTS
    );
    const basePath = path.join(artifactsRoot, 'responses', taskId, 'latest');
    return {
        text_file: `${basePath}.txt`,
        markdown_file: `${basePath}.md`,
        json_file: `${basePath}.json`,
        html_file: `${basePath}.html`,
    };
}

/** @param {any} filePath @returns {string} */
function _guessMime(filePath) {
    const ext = String(path.extname(filePath) || '').toLowerCase();
    if (ext === '.json') return 'application/json';
    if (ext === '.html') return 'text/html';
    if (ext === '.md') return 'text/markdown';
    return 'text/plain';
}

/** @param {any} filePath @returns {number} */
function _statSizeBytes(filePath) {
    try {
        const st = fs.statSync(filePath);
        return Number(st.size) || 0;
    } catch (_) {
        return 0;
    }
}

/**
 * @typedef {object} RegisterResponseArtifactsOptions
 * @property {*} [storage]
 * @property {*} [actor]
 */
/**
 * @typedef {object} RegisterResponseArtifactsArg0
 * @property {Record<string, any>} [storage]
 * @property {string} [actor]
 */
/**
 * @param {RegisterResponseArtifactsArg0} [arg0]
 */
function _registerDiagnosticArtifacts({ storage, actor = 'system' } = {}) {
    /** @type {Record<string, string|null>} */
    const ids = {
        screenshot: null,
        html: null,
        meta: null,
    };

    const pointers = storage && typeof storage === 'object' ? storage : null;
    if (!pointers) return ids;

    const mapping = [
        ['screenshot', pointers.screenshot_file, 'diagnostic_screenshot'],
        ['html', pointers.html_file, 'diagnostic_html'],
        ['meta', pointers.meta_json_file, 'diagnostic_meta'],
    ];

    for (const [k, p, kind] of mapping) {
        if (!p || typeof p !== 'string') continue;
        const sizeBytes = _statSizeBytes(p);
        const mime = _guessMime(p);
        try {
            const id = insertArtifact({
                kind,
                mime,
                size_bytes: sizeBytes,
                storage_uri: p,
                created_by: actor,
                created_at_ms: Date.now(),
            });
            ids[k] = id;
        } catch (_) {
            ids[k] = null;
        }
    }

    return ids;
}

/**
 * @typedef {object} RegisterDiagnosticArtifactsOptions
 * @property {*} [storage]
 * @property {*} [actor]
 */
/**
 * @typedef {object} RegisterDiagnosticArtifactsArg0
 * @property {Record<string, any>} [storage]
 * @property {string} [actor]
 */
/**
 * @param {RegisterDiagnosticArtifactsArg0} [arg0]
 */
function _registerResponseArtifacts({ storage, actor = 'system' } = {}) {
    /** @type {Record<string, string|null>} */
    const ids = {
        text: null,
        md: null,
        json: null,
        html: null,
    };

    const pointers = storage && typeof storage === 'object' ? storage : null;
    if (!pointers) return ids;

    const mapping = [
        ['text', pointers.text_file],
        ['md', pointers.markdown_file],
        ['json', pointers.json_file],
        ['html', pointers.html_file],
    ];

    for (const [k, p] of mapping) {
        if (!p || typeof p !== 'string') continue;
        const sizeBytes = _statSizeBytes(p);
        const mime = _guessMime(p);
        const kind =
            k === 'text'
                ? 'response_text'
                : k === 'md'
                  ? 'response_md'
                  : k === 'json'
                    ? 'response_v2_json'
                    : 'response_html';
        try {
            const id = insertArtifact({
                kind,
                mime,
                size_bytes: sizeBytes,
                storage_uri: p,
                created_by: actor,
                created_at_ms: Date.now(),
            });
            ids[k] = id;
        } catch (_) {
            ids[k] = null;
        }
    }

    return ids;
}

/** @param {any} taskId @returns {any} */
function _getMissionIdForTask(taskId) {
    try {
        const db = getDb();
        const row = /** @type {any} */ (db.prepare('SELECT mission_id FROM tasks WHERE id = ?').get(taskId));
        return row?.mission_id ?? null;
    } catch (_) {
        return null;
    }
}

/**
 * Opções do construtor do TaskStateProjector.
 * @typedef {object} TaskStateProjectorOptions
 * @property {any} nerv - Instância do sistema nerv com método onReceive.
 * @property {string|null} [workerId] - ID opcional do worker.
 */

/**
 * Projetor que escuta mensagens NERV e projeta estado de tarefas no SQLite.
 * Responsável por manter consistência entre mensagens do sistema e estado persistido.
 */
class TaskStateProjector {
    /**
     * Cria um projetor de estado de tarefas.
     * @param {TaskStateProjectorOptions} options - Opções de configuração.
     */
    constructor(options) {
        const { nerv, workerId = null } = options;
        if (!nerv || typeof nerv.onReceive !== 'function') {
            throw new Error('[TaskStateProjector] nerv.onReceive required');
        }
        this.nerv = nerv;
        this.workerId = workerId || null;
        this._unsub = null;

        const base = Number(CONFIG?.all?.TASK_TIMEOUT_MS || 1800000) || 1800000;
        this.runningLockTtlMs = Math.max(60000, base + 60000);
        this.admissionLockTtlMs = Math.max(60000, Number(CONFIG?.all?.TASK_ADMISSION_LOCK_TTL_MS || 300000) || 300000);
    }

    /**
     * ✅ P1-17: Safe wrapper for updateTask() that catches OptimisticLockError.
     * Prevents projector crashes when concurrent updates cause optimistic lock conflicts.
     *
     * @private
     * @param {string} taskId - Task ID to update
     * @param {Record<string, unknown>} updates - Update payload (status, stage, timestamps, etc.)
     * @param {{ critical?: boolean, context?: string }} [options] - Options
     * @returns {boolean} True if update succeeded, false if conflict occurred (non-critical only)
     * @throws {Error} Re-throws OptimisticLockError if options.critical=true
     */
    _safeUpdateTask(taskId, updates, { critical = false, context = '' } = {}) {
        try {
            updateTask(taskId, updates);
            return true;
        } catch (_rawErr) {
            const err = /** @type {any} */ (_rawErr);
            if (err && err.name === 'OptimisticLockError') {
                const msg = context
                    ? `[TaskStateProjector] ${context}: Task ${taskId} update conflict after retries`
                    : `[TaskStateProjector] Task ${taskId} update conflict after retries`;

                log('WARN', msg, String(taskId));

                if (critical) {
                    throw err;
                }

                return false;
            }

            throw err;
        }
    }

    /**
     * Inicia o projetor, registrando handler para mensagens NERV.
     * @returns {void}
     * @sideEffects Registra listener no nerv e inicia projeção de estado.
     */
    start() {
        if (this._unsub) return;
        const maybeUnsub = this.nerv.onReceive((/** @type {any} */ envelope) => {
            try {
                this._handleEnvelope(envelope);
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log('ERROR', `[TaskStateProjector] handler error: ${err?.message || String(err)}`);
            }
        });
        this._unsub = typeof maybeUnsub === 'function' ? maybeUnsub : null;
        log('INFO', '[TaskStateProjector] started (NERV → SQLite)');
    }

    /**
     * Para o projetor, removendo handler de mensagens NERV.
     * @returns {void}
     * @sideEffects Remove listener do nerv.
     */
    stop() {
        if (this._unsub) {
            try {
                this._unsub();
            } catch (_) {
                /* ignore */
            }
            this._unsub = null;
        }
        log('INFO', '[TaskStateProjector] stopped');
    }

    /**
     * Processa um envelope NERV, projetando estado de tarefa no SQLite se for evento suportado.
     * @private
     * @param {any} envelope - Envelope NERV contendo mensagem.
     * @returns {void}
     * @sideEffects Modifica estado do banco de dados baseado no evento.
     */
    _handleEnvelope(envelope) {
        if (getMessageType(envelope) !== MessageType.EVENT) {
            return;
        }

        const actionCode = getActionCode(envelope);
        if (!actionCode || typeof actionCode !== 'string') {
            return;
        }

        // We only project driver task execution events for now.
        /** @type {Set<string>} */
        const supported = new Set([
            ActionCode.DRIVER_TASK_ACCEPTED,
            ActionCode.DRIVER_TASK_HEARTBEAT,
            ActionCode.DRIVER_TASK_STARTED,
            ActionCode.DRIVER_TASK_QUEUED,
            ActionCode.DRIVER_TASK_COMPLETED,
            ActionCode.DRIVER_TASK_FAILED,
            ActionCode.DRIVER_TASK_ABORTED,
            ActionCode.DRIVER_TASK_RETRYING,
            ActionCode.DRIVER_ERROR,
        ]);
        if (!supported.has(actionCode)) {
            return;
        }

        const payload = asRecord(getPayload(envelope));
        const payloadDetails = asRecord(payload.details);
        const taskId = getTaskIdFromPayload(payload);
        if (!taskId) return;

        const correlationId = getCorrelationId(envelope) || null;
        const attemptId = correlationId || null;
        const msgId = getMsgId(envelope) || null;
        const now = Date.now();

        const attemptInvariant = evaluateAttemptInvariants({ taskId, attemptId });
        const currentAttemptId = attemptInvariant.currentAttemptId;
        const isStaleAttempt = !attemptInvariant.apply;

        // Persistent idempotency: prefer msg_id (stable per envelope) over correlation_id (stable per attempt).
        // This ensures redelivery doesn't double-apply, while allowing retries that reuse correlation ids.
        const dedupKey = `drv:${taskId}:${msgId || correlationId || 'none'}:${actionCode}`;
        const inserted = recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: now,
            actorType: 'system',
            eventType: actionCode,
            payload,
            dedupKey,
        });
        if (!inserted) {
            return;
        }

        const markStaleAttemptIgnored = (context = 'stale_attempt') =>
            emitStaleAttemptIgnoredEvent({
                taskId,
                attemptId,
                currentAttemptId,
                actionCode,
                correlationId,
                msgId,
                context,
            });

        if (actionCode === ActionCode.DRIVER_TASK_ACCEPTED || actionCode === ActionCode.DRIVER_TASK_HEARTBEAT) {
            const lockTtlMs =
                actionCode === ActionCode.DRIVER_TASK_ACCEPTED ? this.admissionLockTtlMs : this.runningLockTtlMs;

            try {
                if (attemptId) {
                    const updated = updateAttempt(attemptId, { last_heartbeat_at_ms: now });
                    if (!updated) {
                        upsertAttempt({
                            id: attemptId,
                            task_id: taskId,
                            mission_id: _getMissionIdForTask(taskId),
                            status: 'DISPATCHED',
                            worker_id: null,
                            created_at_ms: now,
                            last_heartbeat_at_ms: now,
                        });
                    }
                }
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log('WARN', `[PROJECTOR] heartbeat/accepted attempt failed: ${err?.message || String(err)}`);
            }

            if (isStaleAttempt) {
                markStaleAttemptIgnored('accepted_or_heartbeat');
                return;
            }

            extendTaskLock({
                taskId,
                workerId: /** @type {any} */ (null),
                nowMs: now,
                lockTtlMs,
            });

            // Keep correlation linkage fresh (helps control/abort routing).
            this._safeUpdateTask(taskId, {
                last_correlation_id: correlationId,
                latest_attempt_id: attemptId,
            });
            return;
        }

        if (actionCode === ActionCode.DRIVER_TASK_STARTED) {
            // Attempt transitions to RUNNING at DRIVER_TASK_STARTED.
            try {
                if (attemptId) {
                    const updated = updateAttempt(attemptId, {
                        status: 'RUNNING',
                        started_at_ms: now,
                        last_heartbeat_at_ms: now,
                    });
                    if (!updated) {
                        upsertAttempt({
                            id: attemptId,
                            task_id: taskId,
                            mission_id: _getMissionIdForTask(taskId),
                            status: 'RUNNING',
                            worker_id: null,
                            created_at_ms: now,
                            started_at_ms: now,
                            last_heartbeat_at_ms: now,
                        });
                    }
                }
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log('WARN', `[PROJECTOR] RUNNING attempt transition failed: ${err?.message || String(err)}`);
            }

            // NERV audit: emit event for attempt state transition
            try {
                recordEvent({
                    entityType: 'attempt',
                    entityId: /** @type {any} */ (attemptId),
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'ATTEMPT_STARTED',
                    payload: { taskId, actionCode },
                    dedupKey: `attempt-started:${attemptId}:${now}`,
                });
            } catch (_) {
                /* best-effort */
            }

            if (isStaleAttempt) {
                markStaleAttemptIgnored('task_started');
                return;
            }

            // Extend lock while running to prevent re-claim due to TTL expiry.
            extendTaskLock({
                taskId,
                workerId: /** @type {any} */ (null),
                nowMs: now,
                lockTtlMs: this.runningLockTtlMs,
            });

            this._safeUpdateTask(taskId, {
                status: 'RUNNING',
                started_at_ms: now,
                last_correlation_id: correlationId,
                latest_attempt_id: attemptId,
            });
            return;
        }

        if (actionCode === ActionCode.DRIVER_TASK_RETRYING) {
            // Tactical retries are internal to the same attempt; do not increment attempts or change domain status.
            return;
        }

        if (actionCode === ActionCode.DRIVER_TASK_QUEUED) {
            if (isStaleAttempt) {
                markStaleAttemptIgnored('task_queued');
                return;
            }
            // Legacy driver-side backpressure (in-memory queue). In SSOT mode, we reschedule in DB and unlock.
            const delayMs = _safeDelayMs(payload) ?? 500;
            const executeAfterMs = now + Math.max(250, delayMs);

            this._safeUpdateTask(taskId, {
                status: 'PENDING',
                stage: TASK_STAGES.READY,
                last_correlation_id: correlationId,
                execute_after_ms: executeAfterMs,
                result_json: {
                    driver_queue: {
                        queue_position: payload.queuePosition ?? null,
                        queue_size: payload.queueSize ?? null,
                        active_drivers: payload.activeDrivers ?? null,
                        next_action: payload.next_action ?? payload.nextAction ?? null,
                        ts_ms: now,
                    },
                },
            });

            try {
                if (attemptId) {
                    const updated = updateAttempt(attemptId, {
                        status: 'FAILED',
                        ended_at_ms: now,
                        error: 'DRIVER_BACKPRESSURE',
                    });
                    if (!updated) {
                        upsertAttempt({
                            id: attemptId,
                            task_id: taskId,
                            mission_id: _getMissionIdForTask(taskId),
                            status: 'FAILED',
                            worker_id: null,
                            created_at_ms: now,
                            ended_at_ms: now,
                            error: 'DRIVER_BACKPRESSURE',
                        });
                    }
                }
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log(
                    'ERROR',
                    `[PROJECTOR] Failed to register attempt for DRIVER_TASK_FAILED (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                );
                // Emit NERV event for visibility
                try {
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: now,
                        actorType: 'system',
                        eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                        payload: {
                            phase: 'attempt_registration',
                            action_code: actionCode,
                            attempt_id: attemptId,
                            error: err?.message || String(err),
                        },
                        dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:${now}`,
                    });
                } catch (_) {
                    /* NERV emit is best-effort */
                }
            }

            releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
            return;
        }

        if (actionCode === ActionCode.DRIVER_TASK_COMPLETED) {
            const result = payload.result;
            const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
            const storage =
                payload.storage && typeof payload.storage === 'object' ? payload.storage : _storagePointers(taskId);

            const artifactIds = _registerResponseArtifacts({ storage, actor: 'system' });

            // Close attempt (best-effort).
            try {
                if (attemptId) {
                    const updated = updateAttempt(attemptId, {
                        status: 'DONE',
                        ended_at_ms: now,
                        response_text_artifact_id: artifactIds.text,
                        response_md_artifact_id: artifactIds.md,
                        response_v2_json_artifact_id: artifactIds.json,
                        response_html_artifact_id: artifactIds.html,
                    });
                    if (!updated) {
                        upsertAttempt({
                            id: attemptId,
                            task_id: taskId,
                            mission_id: _getMissionIdForTask(taskId),
                            status: 'DONE',
                            worker_id: null,
                            created_at_ms: now,
                            ended_at_ms: now,
                            response_text_artifact_id: artifactIds.text,
                            response_md_artifact_id: artifactIds.md,
                            response_v2_json_artifact_id: artifactIds.json,
                            response_html_artifact_id: artifactIds.html,
                        });
                    }
                }
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log(
                    'ERROR',
                    `[PROJECTOR] CRITICAL: Failed to link artifacts for completed task (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                );
                // Emit NERV event for visibility - this is critical as task may complete without artifacts
                try {
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: now,
                        actorType: 'system',
                        eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                        payload: {
                            phase: 'artifact_linking',
                            action_code: actionCode,
                            attempt_id: attemptId,
                            artifact_ids: artifactIds,
                            error: err?.message || String(err),
                        },
                        dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:${now}`,
                    });
                } catch (_) {
                    /* NERV emit is best-effort */
                }
            }

            // NERV audit: emit event for attempt completion
            try {
                recordEvent({
                    entityType: 'attempt',
                    entityId: /** @type {any} */ (attemptId),
                    tsMs: now,
                    actorType: 'system',
                    eventType: 'ATTEMPT_COMPLETED',
                    payload: { taskId, actionCode, hasArtifacts: Boolean(artifactIds.text || artifactIds.md) },
                    dedupKey: `attempt-done:${attemptId}:${now}`,
                });
            } catch (_) {
                /* best-effort */
            }

            if (isStaleAttempt) {
                markStaleAttemptIgnored('task_completed');
                return;
            }

            this._safeUpdateTask(taskId, {
                stage: TASK_STAGES.ARCHIVED,
                status: 'DONE',
                completed_at_ms: now,
                last_correlation_id: correlationId,
                latest_attempt_id: attemptId,
                latest_response_v2_json_artifact_id: artifactIds.json,
                result_json: {
                    storage,
                    storage_format: payload.storage_format ?? null,
                    preview_text: text.slice(0, 2000),
                    output_length: text.length,
                    timings: payload.timings ?? null,
                },
            });

            // Task is terminal; unlock for hygiene.
            releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
            return;
        }

        if (actionCode === ActionCode.DRIVER_TASK_ABORTED) {
            // Intention-sensitive mapping:
            // - If user paused, keep PAUSED (don't turn it into CANCELLED).
            // - Otherwise treat as CANCELLED.
            let nextStatus = 'CANCELLED';
            const reason = payload.reason ? String(payload.reason) : '';
            if (reason === 'USER_PAUSED') {
                nextStatus = 'PAUSED';
            } else {
                try {
                    const db = getDb();
                    const row = /** @type {any} */ (db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId));
                    if (row?.status === 'PAUSED') {
                        nextStatus = 'PAUSED';
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log('WARN', `[PROJECTOR] ABORTED attempt registration failed: ${err?.message || String(err)}`);
                }
            }

            try {
                if (attemptId) {
                    const updated = updateAttempt(attemptId, {
                        status: 'ABORTED',
                        ended_at_ms: now,
                        error: payload.reason ? String(payload.reason) : 'USER_ABORT',
                    });
                    if (!updated) {
                        upsertAttempt({
                            id: attemptId,
                            task_id: taskId,
                            mission_id: _getMissionIdForTask(taskId),
                            status: 'ABORTED',
                            worker_id: null,
                            created_at_ms: now,
                            ended_at_ms: now,
                            error: payload.reason ? String(payload.reason) : 'USER_ABORT',
                        });
                    }
                }
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log(
                    'ERROR',
                    `[PROJECTOR] Failed to register attempt for DRIVER_TASK_ABORTED (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                );
                try {
                    recordEvent({
                        entityType: 'task',
                        entityId: taskId,
                        tsMs: now,
                        actorType: 'system',
                        eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                        payload: {
                            phase: 'attempt_registration',
                            action_code: actionCode,
                            attempt_id: attemptId,
                            error: err?.message || String(err),
                        },
                        dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:${now}`,
                    });
                } catch (_) {
                    /* NERV emit is best-effort */
                }
            }

            if (isStaleAttempt) {
                markStaleAttemptIgnored('task_aborted');
                return;
            }

            this._safeUpdateTask(taskId, {
                status: nextStatus,
                ...(nextStatus === 'PAUSED' ? { paused_at_ms: now } : { cancelled_at_ms: now }),
                last_error: payload.reason ? String(payload.reason) : 'USER_ABORT',
                last_correlation_id: correlationId,
                latest_attempt_id: attemptId,
            });
            releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
            return;
        }

        if (actionCode === ActionCode.DRIVER_TASK_FAILED || actionCode === ActionCode.DRIVER_ERROR) {
            const errText =
                (typeof payload.error === 'string' && payload.error) ||
                (typeof payload.reason === 'string' && payload.reason) ||
                (typeof payload.err === 'string' && payload.err) ||
                'Driver failure';

            const doNotUnlock = Boolean(payload.do_not_unlock ?? payload.doNotUnlock);
            const doNotChangeStatus = Boolean(payload.do_not_change_status ?? payload.doNotChangeStatus);

            // Special case: duplicate dispatch while the task is already running elsewhere.
            // We close the attempt, but must not mutate task status nor unlock its lease.
            if (doNotUnlock || doNotChangeStatus) {
                try {
                    if (attemptId) {
                        const updated = updateAttempt(attemptId, {
                            status: 'FAILED',
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                        });
                        if (!updated) {
                            upsertAttempt({
                                id: attemptId,
                                task_id: taskId,
                                mission_id: _getMissionIdForTask(taskId),
                                status: 'FAILED',
                                worker_id: null,
                                created_at_ms: now,
                                ended_at_ms: now,
                                error: errText.slice(0, 2000),
                            });
                        }
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'ERROR',
                        `[PROJECTOR] Failed to register attempt for duplicate dispatch (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                    );
                    try {
                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: now,
                            actorType: 'system',
                            eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                            payload: {
                                phase: 'attempt_registration',
                                action_code: actionCode,
                                attempt_id: attemptId,
                                context: 'duplicate_dispatch',
                                error: err?.message || String(err),
                            },
                            dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:dup:${now}`,
                        });
                    } catch (_) {
                        /* NERV emit is best-effort */
                    }
                }
                return;
            }

            if (isStaleAttempt) {
                markStaleAttemptIgnored('task_failed_or_error');
                try {
                    if (attemptId) {
                        const reasonCode = payload.reason_code || payload.reasonCode || payload.reason || null;
                        const causeLayer = payload.cause_layer || payload.causeLayer || null;
                        const diagStorage = /** @type {any} */ (
                            payloadDetails.diagnostic_storage || payloadDetails.diagnosticStorage || null);
                        const diagIds = _registerDiagnosticArtifacts({ storage: diagStorage, actor: 'system' });
                        const diagJson = JSON.stringify(diagIds);
                        const summary = payloadDetails.diagnosis_summary || payloadDetails.diagnosisSummary || null;
                        const summaryJson = summary ? JSON.stringify(summary).slice(0, 10000) : null;

                        updateAttempt(attemptId, {
                            status: 'FAILED',
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                            reason_class: payload.reason_class || payload.reasonClass || null,
                            count_attempt: (payload.count_attempt ?? payload.countAttempt) ? 1 : 0,
                            reason_code: reasonCode ? String(reasonCode) : null,
                            cause_layer: causeLayer ? String(causeLayer) : null,
                            diagnostic_artifacts_json: diagJson,
                            diagnosis_json: summaryJson,
                        });
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'ERROR',
                        `[PROJECTOR] Failed to register diagnostic artifacts for stale attempt (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                    );
                    try {
                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: now,
                            actorType: 'system',
                            eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                            payload: {
                                phase: 'diagnostic_artifacts',
                                action_code: actionCode,
                                attempt_id: attemptId,
                                context: 'stale_attempt',
                                error: err?.message || String(err),
                            },
                            dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:stale:${now}`,
                        });
                    } catch (_) {
                        /* NERV emit is best-effort */
                    }
                }
                return;
            }

            const retryable = Boolean(payload.retryable);
            const nextAction = payload.next_action || payload.nextAction || null;
            const delayMs = _safeDelayMs(payload);
            const reasonClass = payload.reason_class || payload.reasonClass || null;

            const reasonCode = payload.reason_code || payload.reasonCode || payload.reason || null;
            const normalizedReasonCode = reasonCode ? String(reasonCode).toUpperCase() : null;
            // Policy: TASK_ERROR generally consumes attempts.
            // Exception: operational LLM timeout is treated as transient (no strategic attempt consumption).
            let countAttempt = Boolean(payload.count_attempt ?? payload.countAttempt ?? false);
            if (reasonClass === 'TASK_ERROR' && normalizedReasonCode !== 'LLM_TIMEOUT') {
                countAttempt = true;
            }
            const causeLayer = payload.cause_layer || payload.causeLayer || null;

            const diagStorage = /** @type {any} */ (payloadDetails.diagnostic_storage || payloadDetails.diagnosticStorage || null);
            const diagIds = _registerDiagnosticArtifacts({ storage: diagStorage, actor: 'system' });
            const diagJson = JSON.stringify(diagIds);
            const summary = payloadDetails.diagnosis_summary || payloadDetails.diagnosisSummary || null;
            const summaryJson = summary ? JSON.stringify(summary).slice(0, 10000) : null;

            const details = payload.details ?? null;
            const detailsJson = details ? JSON.stringify(details).slice(0, 10000) : null;

            // USER_ACTION_REQUIRED → BLOCKED
            if (nextAction === 'BLOCK' || reasonClass === 'USER_ACTION_REQUIRED') {
                this._safeUpdateTask(taskId, {
                    status: 'BLOCKED',
                    stage: TASK_STAGES.READY,
                    blocked_reason: String(payload.reason || 'USER_ACTION_REQUIRED').slice(0, 200),
                    blocked_at_ms: now,
                    blocked_details_json: detailsJson,
                    last_error: errText.slice(0, 2000),
                    last_correlation_id: correlationId,
                    latest_attempt_id: attemptId,
                    execute_after_ms: null,
                });

                try {
                    if (attemptId) {
                        const updated = updateAttempt(attemptId, {
                            status: 'FAILED',
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                            reason_class: 'USER_ACTION_REQUIRED',
                            count_attempt: 0,
                            reason_code: reasonCode ? String(reasonCode) : null,
                            cause_layer: causeLayer ? String(causeLayer) : null,
                            diagnostic_artifacts_json: diagJson,
                            diagnosis_json: summaryJson,
                        });
                        if (!updated) {
                            upsertAttempt({
                                id: attemptId,
                                task_id: taskId,
                                mission_id: _getMissionIdForTask(taskId),
                                status: 'FAILED',
                                worker_id: null,
                                created_at_ms: now,
                                ended_at_ms: now,
                                error: errText.slice(0, 2000),
                                reason_class: 'USER_ACTION_REQUIRED',
                                count_attempt: 0,
                                reason_code: reasonCode ? String(reasonCode) : null,
                                cause_layer: causeLayer ? String(causeLayer) : null,
                                diagnostic_artifacts_json: diagJson,
                                diagnosis_json: summaryJson,
                            });
                        }
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'ERROR',
                        `[PROJECTOR] Failed to register diagnostic artifacts for USER_ACTION_REQUIRED (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                    );
                    try {
                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: now,
                            actorType: 'system',
                            eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                            payload: {
                                phase: 'diagnostic_artifacts',
                                action_code: actionCode,
                                attempt_id: attemptId,
                                context: 'user_action_required',
                                error: err?.message || String(err),
                            },
                            dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:block:${now}`,
                        });
                    } catch (_) {
                        /* NERV emit is best-effort */
                    }
                }

                releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
                return;
            }

            // ENV_UNAVAILABLE → reschedule (do not consume attempts)
            if (reasonClass === 'ENV_UNAVAILABLE') {
                const executeAfterMs = now + Math.max(250, delayMs ?? 2000);

                this._safeUpdateTask(taskId, {
                    status: 'PENDING',
                    stage: TASK_STAGES.READY,
                    last_error: errText.slice(0, 2000),
                    last_correlation_id: correlationId,
                    latest_attempt_id: attemptId,
                    execute_after_ms: executeAfterMs,
                    blocked_reason: null,
                    blocked_at_ms: null,
                    blocked_details_json: null,
                });

                try {
                    if (attemptId) {
                        const updated = updateAttempt(attemptId, {
                            status: 'FAILED',
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                            reason_class: 'ENV_UNAVAILABLE',
                            count_attempt: 0,
                            reason_code: reasonCode ? String(reasonCode) : null,
                            cause_layer: causeLayer ? String(causeLayer) : null,
                            diagnostic_artifacts_json: diagJson,
                            diagnosis_json: summaryJson,
                        });
                        if (!updated) {
                            upsertAttempt({
                                id: attemptId,
                                task_id: taskId,
                                mission_id: _getMissionIdForTask(taskId),
                                status: 'FAILED',
                                worker_id: null,
                                created_at_ms: now,
                                ended_at_ms: now,
                                error: errText.slice(0, 2000),
                                reason_class: 'ENV_UNAVAILABLE',
                                count_attempt: 0,
                                reason_code: reasonCode ? String(reasonCode) : null,
                                cause_layer: causeLayer ? String(causeLayer) : null,
                                diagnostic_artifacts_json: diagJson,
                                diagnosis_json: summaryJson,
                            });
                        }
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'ERROR',
                        `[PROJECTOR] Failed to register diagnostic artifacts for ENV_UNAVAILABLE (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                    );
                    try {
                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: now,
                            actorType: 'system',
                            eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                            payload: {
                                phase: 'diagnostic_artifacts',
                                action_code: actionCode,
                                attempt_id: attemptId,
                                context: 'env_unavailable',
                                error: err?.message || String(err),
                            },
                            dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:env:${now}`,
                        });
                    } catch (_) {
                        /* NERV emit is best-effort */
                    }
                }

                releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
                return;
            }

            // TASK_ERROR → retry with max_attempts gate.
            // Policy: TASK_ERROR always consumes attempts (count_attempt is forced to true above).
            if (reasonClass === 'TASK_ERROR') {
                let maxAttempts;
                let currentAttempts;
                try {
                    const db = getDb();
                    const row = /** @type {any} */ (db.prepare('SELECT attempts, task_json FROM tasks WHERE id = ?').get(taskId));
                    currentAttempts = Number(row?.attempts ?? 0) || 0;
                    try {
                        const taskJson = row?.task_json ? JSON.parse(row.task_json) : null;
                        maxAttempts = Math.max(1, Number(taskJson?.policy?.max_attempts ?? 3) || 3);
                    } catch (_) {
                        maxAttempts = 3;
                    }
                } catch (_) {
                    currentAttempts = 0;
                    maxAttempts = 3;
                }

                const nextAttempts = countAttempt ? currentAttempts + 1 : currentAttempts;
                if (countAttempt) {
                    incrementTaskAttempts(taskId, 1);
                }

                try {
                    if (attemptId) {
                        const updated = updateAttempt(attemptId, {
                            status: 'FAILED',
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                            reason_class: 'TASK_ERROR',
                            count_attempt: countAttempt ? 1 : 0,
                            reason_code: reasonCode ? String(reasonCode) : null,
                            cause_layer: causeLayer ? String(causeLayer) : null,
                            diagnostic_artifacts_json: diagJson,
                            diagnosis_json: summaryJson,
                        });
                        if (!updated) {
                            upsertAttempt({
                                id: attemptId,
                                task_id: taskId,
                                mission_id: _getMissionIdForTask(taskId),
                                status: 'FAILED',
                                worker_id: null,
                                created_at_ms: now,
                                ended_at_ms: now,
                                error: errText.slice(0, 2000),
                                reason_class: 'TASK_ERROR',
                                count_attempt: countAttempt ? 1 : 0,
                                reason_code: reasonCode ? String(reasonCode) : null,
                                cause_layer: causeLayer ? String(causeLayer) : null,
                                diagnostic_artifacts_json: diagJson,
                                diagnosis_json: summaryJson,
                            });
                        }
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'ERROR',
                        `[PROJECTOR] Failed to register diagnostic artifacts for TASK_ERROR (taskId=${taskId}, attemptId=${attemptId}): ${err?.message || String(err)}`
                    );
                    try {
                        recordEvent({
                            entityType: 'task',
                            entityId: taskId,
                            tsMs: now,
                            actorType: 'system',
                            eventType: ActionCode.ARTIFACT_REGISTRATION_FAILED,
                            payload: {
                                phase: 'diagnostic_artifacts',
                                action_code: actionCode,
                                attempt_id: attemptId,
                                context: 'task_error',
                                error: err?.message || String(err),
                            },
                            dedupKey: `art-fail:${taskId}:${attemptId}:${actionCode}:terr:${now}`,
                        });
                    } catch (_) {
                        /* NERV emit is best-effort */
                    }
                }

                // Operational TASK_ERRORs (e.g., LLM_TIMEOUT) and future no-count policies.
                if (!countAttempt) {
                    const base = 30000;
                    const max = 120000;
                    const jitter = Math.floor(Math.random() * 500);
                    const computed = Math.min(max, base + Math.floor(Math.random() * 5000));
                    const executeAfterMs = now + Math.max(base, delayMs ?? computed) + jitter;

                    this._safeUpdateTask(taskId, {
                        status: 'PENDING',
                        stage: TASK_STAGES.READY,
                        last_error: errText.slice(0, 2000),
                        last_correlation_id: correlationId,
                        latest_attempt_id: attemptId,
                        execute_after_ms: executeAfterMs,
                        blocked_reason: null,
                        blocked_at_ms: null,
                        blocked_details_json: null,
                    });
                    releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
                    return;
                }

                if (nextAttempts >= maxAttempts) {
                    this._safeUpdateTask(taskId, {
                        status: 'FAILED',
                        stage: TASK_STAGES.ARCHIVED,
                        failed_at_ms: now,
                        last_error: errText.slice(0, 2000),
                        last_correlation_id: correlationId,
                        latest_attempt_id: attemptId,
                        execute_after_ms: null,
                        blocked_reason: null,
                        blocked_at_ms: null,
                        blocked_details_json: null,
                    });
                    releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
                    return;
                }

                const base = 2000;
                const exp = Math.min(6, Math.max(0, nextAttempts - 1));
                const computed = Math.min(120000, base * Math.pow(2, exp));
                const jitter = Math.floor(Math.random() * 250);
                const executeAfterMs = now + Math.max(250, delayMs ?? computed) + jitter;

                this._safeUpdateTask(taskId, {
                    status: 'PENDING',
                    stage: TASK_STAGES.READY,
                    last_error: errText.slice(0, 2000),
                    last_correlation_id: correlationId,
                    latest_attempt_id: attemptId,
                    execute_after_ms: executeAfterMs,
                    blocked_reason: null,
                    blocked_at_ms: null,
                    blocked_details_json: null,
                });
                releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
                return;
            }

            if (retryable && (nextAction === 'RETRY_LATER' || delayMs !== null)) {
                const executeAfterMs = now + Math.max(250, delayMs ?? 1000);

                this._safeUpdateTask(taskId, {
                    status: 'PENDING',
                    stage: TASK_STAGES.READY,
                    last_error: errText.slice(0, 2000),
                    last_correlation_id: correlationId,
                    latest_attempt_id: attemptId,
                    execute_after_ms: executeAfterMs,
                    blocked_reason: null,
                    blocked_at_ms: null,
                    blocked_details_json: null,
                });

                try {
                    if (attemptId) {
                        const updated = updateAttempt(attemptId, {
                            status: 'FAILED',
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                            reason_class: reasonClass ? String(reasonClass) : null,
                            count_attempt: countAttempt ? 1 : 0,
                            reason_code: reasonCode ? String(reasonCode) : null,
                            cause_layer: causeLayer ? String(causeLayer) : null,
                            diagnostic_artifacts_json: diagJson,
                            diagnosis_json: summaryJson,
                        });
                        if (!updated) {
                            upsertAttempt({
                                id: attemptId,
                                task_id: taskId,
                                mission_id: _getMissionIdForTask(taskId),
                                status: 'FAILED',
                                worker_id: null,
                                created_at_ms: now,
                                ended_at_ms: now,
                                error: errText.slice(0, 2000),
                                reason_class: reasonClass ? String(reasonClass) : null,
                                count_attempt: countAttempt ? 1 : 0,
                                reason_code: reasonCode ? String(reasonCode) : null,
                                cause_layer: causeLayer ? String(causeLayer) : null,
                                diagnostic_artifacts_json: diagJson,
                                diagnosis_json: summaryJson,
                            });
                        }
                    }
                } catch (_rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log('WARN', `[PROJECTOR] diagnostic artifact registration failed: ${err?.message || String(err)}`);
                }

                releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
                return;
            }

            this._safeUpdateTask(taskId, {
                status: 'FAILED',
                failed_at_ms: now,
                last_error: errText.slice(0, 2000),
                last_correlation_id: correlationId,
                latest_attempt_id: attemptId,
            });

            try {
                if (attemptId) {
                    const updated = updateAttempt(attemptId, {
                        status: 'FAILED',
                        ended_at_ms: now,
                        error: errText.slice(0, 2000),
                        reason_class: reasonClass ? String(reasonClass) : null,
                        count_attempt: countAttempt ? 1 : 0,
                        reason_code: reasonCode ? String(reasonCode) : null,
                        cause_layer: causeLayer ? String(causeLayer) : null,
                        diagnostic_artifacts_json: diagJson,
                        diagnosis_json: summaryJson,
                    });
                    if (!updated) {
                        upsertAttempt({
                            id: attemptId,
                            task_id: taskId,
                            mission_id: _getMissionIdForTask(taskId),
                            status: 'FAILED',
                            worker_id: null,
                            created_at_ms: now,
                            ended_at_ms: now,
                            error: errText.slice(0, 2000),
                            reason_class: reasonClass ? String(reasonClass) : null,
                            count_attempt: countAttempt ? 1 : 0,
                            reason_code: reasonCode ? String(reasonCode) : null,
                            cause_layer: causeLayer ? String(causeLayer) : null,
                            diagnostic_artifacts_json: diagJson,
                            diagnosis_json: summaryJson,
                        });
                    }
                }
            } catch (_rawErr) {
                const err = /** @type {any} */ (_rawErr);
                log('WARN', `[PROJECTOR] attempt state update failed: ${err?.message || String(err)}`);
            }
            releaseTaskLockForAttempt({ taskId, attemptId, actionCode, correlationId, context: 'projector' });
        }
    }
}

export { TaskStateProjector };
