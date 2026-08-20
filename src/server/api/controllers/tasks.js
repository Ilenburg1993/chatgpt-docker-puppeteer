// @ts-check
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
/** Constante/valor exportado: default. */
const router = express.Router();

import { audit, log } from '#core/logger';
import * as schemas from '#core/schemas';
import { insertArtifact } from '#infra/db/artifact_repo';
import { recordEvent } from '#infra/db/events_repo';
import { getDb } from '#infra/db/sqlite';
import { getAttemptById, listAttemptsByTask } from '#infra/db/task_attempt_repo';
import {
    clearQueuePreserveRunning,
    countTasks,
    getTaskById,
    listTasks,
    insertTask as persistTaskInsert,
    updateTask as persistTaskUpdate,
    releaseTaskLock,
    retryFailedTasks,
} from '#infra/db/task_repo';
import { putJson, readText as readArtifactText } from '#infra/storage/artifact_store';
import { executeCommand } from '#server/domain/control_command_service';
import schemaGuard from '../../middleware/schema_guard.js';
import { fail, ok } from '../utils/api_envelope.js';

const ALLOWED_TASK_STAGES = new Set(['DRAFT', 'PROPOSED', 'READY', 'REJECTED', 'ARCHIVED']);
const ALLOWED_TASK_STATUSES = new Set([
    'PENDING',
    'RUNNING',
    'DONE',
    'FAILED',
    'PAUSED',
    'SKIPPED',
    'CANCELLED',
    'BLOCKED',
]);
const ALLOWED_TARGETS = new Set(['auto', 'chatgpt', 'gemini', 'claude', 'ollama']);

function _safeId(/** @type {any} */ raw) {
    return String(raw || '').replace(/[^a-zA-Z0-9._-]/g, '');
}

/** @typedef {any} SafeUpdateTaskUpdates */
/** @typedef {any} SafeUpdateTaskOptions */
/**
 * ✅ P1-17: Safe wrapper for _safeUpdateTask() that catches OptimisticLockError. Returns null on conflict, allowing API
 * to return 409 Conflict.
 *
 * @param {string} taskId - Task ID
 * @param {SafeUpdateTaskUpdates} updates - Updates
 * @param {SafeUpdateTaskOptions} [options] - Options
 * @returns {object | null} Updated task or null on conflict
 */
function _safeUpdateTask(taskId, updates, { throwOnConflict = false } = {}) {
    try {
        return persistTaskUpdate(taskId, updates);
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        if (err && _e.name === 'OptimisticLockError') {
            log('WARN', `[TasksAPI] Task ${taskId} update conflict after retries`);
            if (throwOnConflict) throw err;
            return null;
        }
        throw err;
    }
}

/**
 * Detects cycles in task dependency graph using DFS.
 *
 * @param {string} taskId - Starting task ID
 * @param {string[]} newDeps - New dependencies being added
 * @param {Set<string>} [visited] - Already visited in current path
 * @returns {{ hasCycle: boolean; path?: string[] }}
 */
function _detectDependencyCycle(taskId, newDeps, visited = new Set()) {
    if (visited.has(taskId)) {
        return { hasCycle: true, path: [...visited, taskId] };
    }

    visited.add(taskId);
    const db = getDb();

    // For the starting task, use the NEW dependencies we're about to set
    const depsToCheck = visited.size === 1 ? newDeps : null;

    if (!depsToCheck) {
        // For non-starting tasks, read existing dependencies from DB
        const rows = db.prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?').all(taskId);
        const existingDeps = rows.map((/** @type {any} */ r) => String(r.depends_on_task_id));

        for (const depId of existingDeps) {
            const result = _detectDependencyCycle(depId, newDeps, new Set(visited));
            if (result.hasCycle) {
                return result;
            }
        }
    } else {
        // Check new dependencies
        for (const depId of depsToCheck) {
            const result = _detectDependencyCycle(depId, newDeps, new Set(visited));
            if (result.hasCycle) {
                return result;
            }
        }
    }

    return { hasCycle: false };
}

function _getLockSnapshot(/** @type {any} */ taskId) {
    const db = getDb();
    const row = /** @type {any} */ (
        db.prepare('SELECT locked_by, lock_expires_at_ms, status, stage FROM tasks WHERE id = ?').get(taskId)
    );
    if (!row) return null;
    return {
        locked_by: row.locked_by ? String(row.locked_by) : null,
        lock_expires_at_ms:
            row.lock_expires_at_ms !== null && row.lock_expires_at_ms !== undefined
                ? Number(row.lock_expires_at_ms)
                : null,
        status: row.status ? String(row.status) : null,
        stage: row.stage ? String(row.stage) : null,
    };
}

function _isTaskActivelyClaimed(/** @type {any} */ lockSnapshot, nowMs = Date.now()) {
    if (!lockSnapshot) return false;
    if (!lockSnapshot.locked_by) return false;
    const exp = Number(lockSnapshot.lock_expires_at_ms);
    if (!Number.isFinite(exp)) return false;
    return exp > nowMs;
}

function _uniqStrings(/** @type {any} */ list) {
    const out = [];
    const seen = new Set();
    for (const v of Array.isArray(list) ? list : []) {
        const s = String(v || '').trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

async function _runTaskControlCommand(
    /** @type {any} */ req,
    /** @type {any} */ res,
    /** @type {any} */ command,
    /** @type {any} */ payload = {},
) {
    try {
        const result = await executeCommand({
            command,
            payload: {
                ...payload,
                reason: payload.reason || req.body?.reason || `${command.toLowerCase()} via /api/tasks`,
                idempotency_key:
                    payload.idempotency_key ||
                    `${req.id}:${command}:${payload.task_id || (Array.isArray(payload.ids) ? payload.ids.join(',') : 'n/a')}`,
            },
            actor: req.user || { id: req.ip || null, username: req.ip || null, role: 'anonymous', permissions: [] },
        });

        return result;
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        res.status(Number(_e?.statusCode || 500)).json({
            success: false,
            code: _e?.code || 'TASK_CONTROL_FAILED',
            error: _e?.message || 'Falha no comando de task',
            details: _e?.details || null,
            request_id: req.id,
        });
        return null;
    }
}

/* --------------------------------------------------------------------------
   1. OPERAÇÕES DE CONSULTA E CRIAÇÃO (CRUD)
-------------------------------------------------------------------------- */

/**
 * GET / Lista tarefas com paginação. Query params: page (default 1), limit (default 100, max 1000)
 */
router.get('/', async (req, res) => {
    try {
        // Parse pagination parameters
        const page = Math.max(1, parseInt(String(req.query['page']), 10) || 1);
        const limit = Math.min(1000, Math.max(1, parseInt(String(req.query['limit']), 10) || 100));
        const offset = (page - 1) * limit;

        // Get optional filters
        const status = req.query['status'] ? String(req.query['status']) : null;
        const stage = req.query['stage'] ? String(req.query['stage']) : null;
        const missionId = req.query['missionId'] ? String(req.query['missionId']) : null;

        // Fetch paginated tasks and total count in parallel
        const [tasks, total] = await Promise.all([
            Promise.resolve(listTasks({ limit, offset, status, stage, missionId })),
            Promise.resolve(countTasks({ status, stage, missionId })),
        ]);

        const totalPages = Math.ceil(total / limit);

        // Return paginated response with metadata
        ok(
            res,
            req,
            { items: tasks },
            {
                limit,
                total,
                page,
                totalPages,
            },
        );
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao ler fila: ${_e.message}`, req.id);
        fail(res, req, 500, {
            code: 'TASKS_LIST_FAILED',
            error: 'Erro interno ao acessar a fila de tarefas.',
            details: _e.message,
        });
    }
});

/**
 * POST / Ingestão de nova tarefa com cura automática para o padrão V4 Gold.
 */
router.post('/', async (req, res) => {
    try {
        const nowIso = new Date().toISOString();

        const incomingId = req.body?.meta?.id ? String(req.body.meta.id) : null;
        const safeId = (incomingId || `task-${uuidv4()}`).replace(/[^a-zA-Z0-9._-]/g, '');

        const target = req.body?.spec?.target || req.body?.meta?.agent || req.body?.meta?.target || 'chatgpt';
        const normalizedTarget = String(target).toLowerCase().trim();
        if (!ALLOWED_TARGETS.has(normalizedTarget)) {
            return res.status(400).json({
                success: false,
                error: 'Target inválido',
                details: { allowed: Array.from(ALLOWED_TARGETS), provided: normalizedTarget },
                request_id: req.id,
            });
        }

        const userMessage =
            req.body?.spec?.payload?.user_message || req.body?.spec?.payload?.prompt || req.body?.prompt || '';

        const systemMessage = req.body?.spec?.payload?.system_message || '';

        const model = req.body?.spec?.model || req.body?.spec?.payload?.model || null;

        const priorityRaw = req.body?.meta?.priority;
        const priority = Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : 5;

        const stageRaw = req.body?.stage ?? req.body?.meta?.stage ?? null;
        const stage = stageRaw ? String(stageRaw).toUpperCase().trim() : 'READY';
        const allowedStages = new Set(['DRAFT', 'PROPOSED', 'READY']);
        const desiredStage = allowedStages.has(stage) ? stage : 'READY';

        const taskV5 = schemas.core.TaskSchemaV5.parse({
            meta: {
                id: safeId,
                version: '5.0',
                created_at: req.body?.meta?.created_at || nowIso,
                priority,
                source: 'gui',
                tags: Array.isArray(req.body?.meta?.tags) ? req.body.meta.tags : [],
                mission_id: req.body?.meta?.mission_id || undefined,
                workflow_id: req.body?.meta?.workflow_id || undefined,
            },
            spec: {
                target: normalizedTarget,
                model: model ? String(model) : undefined,
                payload: {
                    system_message: String(systemMessage || ''),
                    user_message: String(userMessage || ''),
                    context: req.body?.spec?.payload?.context ?? undefined,
                },
                parameters: req.body?.spec?.parameters || undefined,
                execution: req.body?.spec?.execution || undefined,
                validation: req.body?.spec?.validation || undefined,
                context_config: req.body?.spec?.context_config || undefined,
                config: req.body?.spec?.config || undefined,
            },
            policy: {
                max_attempts: req.body?.policy?.max_attempts ?? undefined,
                timeout_ms: req.body?.policy?.timeout_ms ?? undefined,
                dependencies: Array.isArray(req.body?.policy?.dependencies) ? req.body.policy.dependencies : undefined,
                execute_after: req.body?.policy?.execute_after ?? null,
                priority_weight: req.body?.policy?.priority_weight ?? undefined,
                workflow_policy: req.body?.policy?.workflow_policy ?? undefined,
            },
            state: {
                status: 'PENDING',
            },
            result: {},
        });

        // Dual storage: persist prompt template as artifact (best-effort).
        let promptTemplateArtifactId = null;
        try {
            const stored = await putJson({
                kind: 'prompt_template',
                json: {
                    system_message: taskV5.spec?.payload?.system_message || '',
                    user_message: taskV5.spec?.payload?.user_message || '',
                },
                relPath: `prompts/templates/${safeId}/${Date.now()}.json`,
                mime: 'application/json',
            });
            promptTemplateArtifactId = insertArtifact({
                kind: 'prompt_template',
                mime: stored.mime,
                size_bytes: stored.sizeBytes,
                sha256: stored.sha256,
                storage_uri: stored.storageUri,
                created_by: 'user',
                created_at_ms: Date.now(),
            });
        } catch (/** @type {any} */ _) {
            promptTemplateArtifactId = null;
        }

        // Idempotency: check if task already exists before insert
        const existing = /** @type {any} */ (getTaskById(safeId));
        let created = false;

        if (existing) {
            // Task already exists - check if this is a duplicate request
            const clientRequestId = req.body?.client_request_id ? String(req.body.client_request_id) : null;
            if (clientRequestId) {
                // If client provided a request ID, treat as idempotent retry
                log(
                    'INFO',
                    `[API_TASKS] Idempotent retry detected for task ${safeId} with client_request_id ${clientRequestId}`,
                    req.id,
                );
            }
            // Return existing task
        } else {
            // Create new task
            persistTaskInsert(taskV5, {
                stage: desiredStage,
                status: 'PENDING',
                actor: 'gui',
                promptTemplateArtifactId,
            });
            created = true;

            // eslint-disable-next-line @typescript-eslint/await-thenable
            await audit('CREATE_TASK', {
                id: safeId,
                source: 'GUI',
                request_id: req.id,
            });
            recordEvent({
                entityType: 'task',
                entityId: safeId,
                actorType: 'user',
                actorId: req.ip || null,
                eventType: 'TASK_CREATED_BY_USER',
                payload: { request_id: req.id, stage: desiredStage, status: 'PENDING' },
                dedupKey: `req:${req.id}:task:${safeId}:created`,
            });
        }

        return res.json({
            success: true,
            created,
            id: safeId,
            task: created ? getTaskById(safeId) : existing,
            request_id: req.id,
        });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('WARN', `[API_TASKS] Ingestão rejeitada: ${_e.message}`, req.id);
        return res.status(400).json({
            success: false,
            error: `Dados da tarefa inválidos: ${_e.message}`,
            request_id: req.id,
        });
    }
});

/**
 * PUT /:id Atualização parcial ou total de uma tarefa existente.
 *
 * @param {any} req
 * @param {any} res
 */
async function handleTaskUpdate(req, res) {
    try {
        const safeId = _safeId(req.params.id);
        const existing = /** @type {any} */ (getTaskById(safeId));
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Task não encontrada', request_id: req.id });
        }

        const lockSnapshot = _getLockSnapshot(safeId);
        const nowMs = Date.now();
        const currentDbStatus = lockSnapshot?.status ? String(lockSnapshot.status).toUpperCase().trim() : null;
        if (currentDbStatus === 'PENDING' && _isTaskActivelyClaimed(lockSnapshot, nowMs)) {
            return res.status(409).json({
                success: false,
                error: 'Task em processamento (claim)',
                message:
                    'A task foi clamada por um worker e pode estar prestes a iniciar. Pause/cancele e tente novamente.',
                details: {
                    locked_by: /** @type {any} */ (lockSnapshot).locked_by,
                    lock_expires_at_ms: /** @type {any} */ (lockSnapshot).lock_expires_at_ms,
                },
                request_id: req.id,
            });
        }

        const currentStatus = String(existing.unified_status || existing.state?.status || '')
            .toUpperCase()
            .trim();
        if (currentStatus === 'RUNNING') {
            return res.status(409).json({
                success: false,
                error: 'Task em execução',
                message: 'Edite após pausar/cancelar. Use /api/tasks/:id/pause ou DELETE /api/tasks/:id.',
                request_id: req.id,
            });
        }

        const desiredStatusRaw = req.body?.unified_status || req.body?.status || req.body?.state?.status || null;
        const desiredStatus = desiredStatusRaw ? String(desiredStatusRaw).toUpperCase().trim() : null;
        const desiredStageRaw = req.body?.stage || null;
        const desiredStage = desiredStageRaw ? String(desiredStageRaw).toUpperCase().trim() : null;

        if (desiredStatus && !ALLOWED_TASK_STATUSES.has(desiredStatus)) {
            return res.status(400).json({
                success: false,
                error: 'Status inválido',
                details: { allowed: Array.from(ALLOWED_TASK_STATUSES), provided: desiredStatus },
                request_id: req.id,
            });
        }
        if (desiredStage && !ALLOWED_TASK_STAGES.has(desiredStage)) {
            return res.status(400).json({
                success: false,
                error: 'Stage inválido',
                details: { allowed: Array.from(ALLOWED_TASK_STAGES), provided: desiredStage },
                request_id: req.id,
            });
        }

        const merged = {
            ...existing,
            ...req.body,
            meta: {
                ...(existing.meta || {}),
                ...(req.body?.meta || {}),
                id: safeId,
                version: '5.0',
            },
            spec: {
                ...(existing.spec || {}),
                ...(req.body?.spec || {}),
                payload: {
                    ...(existing.spec?.payload || {}),
                    ...(req.body?.spec?.payload || {}),
                },
            },
            policy: {
                ...(existing.policy || {}),
                ...(req.body?.policy || {}),
            },
        };

        // Back-compat: payload.model → spec.model
        if (merged?.spec?.payload?.model && !merged?.spec?.model) {
            merged.spec.model = merged.spec.payload.model;
        }
        // Back-compat: meta.agent → spec.target
        if (merged?.meta?.agent && !merged?.spec?.target) {
            merged.spec.target = merged.meta.agent;
        }

        const validated = schemas.core.TaskSchemaV5.parse(merged);
        const validatedTarget = String(validated?.spec?.target || '')
            .toLowerCase()
            .trim();
        if (!ALLOWED_TARGETS.has(validatedTarget)) {
            return res.status(400).json({
                success: false,
                error: 'Target inválido',
                details: { allowed: Array.from(ALLOWED_TARGETS), provided: validatedTarget },
                request_id: req.id,
            });
        }
        const now = Date.now();

        // Dual storage: persist updated prompt template as artifact (best-effort).
        let promptTemplateArtifactId = null;
        try {
            const stored = await putJson({
                kind: 'prompt_template',
                json: {
                    system_message: validated.spec?.payload?.system_message || '',
                    user_message: validated.spec?.payload?.user_message || '',
                },
                relPath: `prompts/templates/${safeId}/${now}.json`,
                mime: 'application/json',
            });
            promptTemplateArtifactId = insertArtifact({
                kind: 'prompt_template',
                mime: stored.mime,
                size_bytes: stored.sizeBytes,
                sha256: stored.sha256,
                storage_uri: stored.storageUri,
                created_by: 'user',
                created_at_ms: now,
            });
        } catch (/** @type {any} */ _) {
            promptTemplateArtifactId = null;
        }

        const extra = /** @type {any} */ ({});
        if (desiredStatus === 'CANCELLED') {
            extra.cancelled_at_ms = now;
        } else if (desiredStatus === 'PAUSED') {
            extra.paused_at_ms = now;
        } else if (desiredStatus === 'PENDING') {
            // resume
            extra.paused_at_ms = null;
        }

        const updated = _safeUpdateTask(safeId, {
            task: validated,
            ...(desiredStatus ? { status: desiredStatus } : {}),
            ...(desiredStage ? { stage: desiredStage } : {}),
            ...(promptTemplateArtifactId ? { prompt_template_artifact_id: promptTemplateArtifactId } : {}),
            ...extra,
        });

        // Optimistic locking: updateTask returns null if concurrent modification detected
        if (!updated) {
            return res.status(409).json({
                success: false,
                error: 'Concurrent modification detected',
                message:
                    'A task foi modificada por outro processo durante esta operação. Recarregue e tente novamente.',
                request_id: req.id,
            });
        }

        if (desiredStatus || desiredStage) {
            try {
                releaseTaskLock({ taskId: safeId });
            } catch (/** @type {any} */ _) {
                /* ignore */
            }
        }

        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('EDIT_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        recordEvent({
            entityType: 'task',
            entityId: safeId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'TASK_UPDATED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:task:${safeId}:updated`,
        });

        res.json({
            success: true,
            task: updated,
            request_id: req.id,
        });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha na atualização: ${_e.message}`, req.id);
        res.status(400).json({
            success: false,
            error: _e.message,
            request_id: req.id,
        });
    }
}

router.put('/:id', handleTaskUpdate);

// PATCH (Dashboard V2 uses PATCH)
router.patch('/:id', handleTaskUpdate);

/* --------------------------------------------------------------------------
   1.25. ATTEMPTS + PROMPTS (histórico auditável)
-------------------------------------------------------------------------- */

router.get('/:id/attempts', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const attempts = listAttemptsByTask(safeId, { limit: 200 });
        res.json({ success: true, attempts, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao listar attempts: ${_e.message}`, req.id);
        res.status(500).json({ success: false, error: 'Falha ao listar attempts.', request_id: req.id });
    }
});

router.get('/:id/prompt', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const task = getTaskById(safeId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task não encontrada', request_id: req.id });
        }

        const attemptId = req.query?.['attempt'] ? String(req.query['attempt']) : task.latest_attempt_id || null;
        if (!attemptId) {
            return res.status(404).json({ success: false, error: 'Attempt não especificado', request_id: req.id });
        }

        const attempt = getAttemptById(attemptId);
        if (!attempt || attempt['task_id'] !== safeId) {
            return res.status(404).json({ success: false, error: 'Attempt não encontrado', request_id: req.id });
        }

        const artId = attempt['rendered_prompt_artifact_id'] || null;
        if (!artId) {
            return res
                .status(404)
                .json({ success: false, error: 'Prompt renderizado não disponível', request_id: req.id });
        }

        const text = await readArtifactText(artId);
        if (!text) {
            return res.status(404).json({ success: false, error: 'Artefato não encontrado', request_id: req.id });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${safeId}-${attemptId}-prompt.txt"`);
        return res.send(text);
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao baixar prompt: ${_e.message}`, req.id);
        return res.status(500).json({ success: false, error: 'Falha ao baixar prompt.', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   1.3 DEPENDÊNCIAS (SSOT) — write-path para dashboard (tabela + grafo)
-------------------------------------------------------------------------- */

router.get('/:id/dependencies', async (req, res) => {
    try {
        const taskId = _safeId(req.params.id);
        const task = getTaskById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task não encontrada', request_id: req.id });
        }

        const db = getDb();
        const rows = db
            .prepare(
                'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_task_id ASC',
            )
            .all(taskId);
        const deps = rows.map((/** @type {any} */ r) => String(r.depends_on_task_id));
        return res.json({ success: true, task_id: taskId, dependencies: deps, request_id: req.id });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[API_TASKS] Falha ao ler dependências: ${_e?.message || String(_e)}`, req.id);
        return res.status(500).json({ success: false, error: 'Falha ao ler dependências.', request_id: req.id });
    }
});

const replaceDependenciesSchema = z.object({
    dependencies: z.array(z.string()).max(500),
});

router.put('/:id/dependencies', schemaGuard(replaceDependenciesSchema), async (req, res) => {
    try {
        const taskId = _safeId(req.params['id']);
        const existing = /** @type {any} */ (getTaskById(taskId));
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Task não encontrada', request_id: req.id });
        }
        const status = String(existing.unified_status || existing.state?.status || '')
            .toUpperCase()
            .trim();
        if (status === 'RUNNING') {
            return res.status(409).json({
                success: false,
                error: 'Task em execução: não é permitido editar dependências',
                request_id: req.id,
            });
        }

        const lockSnapshot = _getLockSnapshot(taskId);
        const nowMs = Date.now();
        const currentDbStatus = lockSnapshot?.status ? String(lockSnapshot.status).toUpperCase().trim() : null;
        if (currentDbStatus === 'PENDING' && _isTaskActivelyClaimed(lockSnapshot, nowMs)) {
            return res.status(409).json({
                success: false,
                error: 'Task em processamento (claim)',
                message:
                    'A task foi clamada por um worker e pode estar prestes a iniciar. Pause/cancele e tente novamente.',
                details: {
                    locked_by: /** @type {any} */ (lockSnapshot).locked_by,
                    lock_expires_at_ms: /** @type {any} */ (lockSnapshot).lock_expires_at_ms,
                },
                request_id: req.id,
            });
        }

        const incoming = _uniqStrings(req.body.dependencies).map(_safeId).filter(Boolean);
        const deps = incoming.filter((d) => d && d !== taskId);

        const db = getDb();
        if (deps.length > 0) {
            const placeholders = deps.map(() => '?').join(',');
            const found = db
                .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders})`)
                .all(...deps)
                .map((/** @type {any} */ r) => String(r.id));
            const foundSet = new Set(found);
            const missing = deps.filter((d) => !foundSet.has(d));
            if (missing.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Dependências inválidas: task(s) não encontrada(s).',
                    details: { missing },
                    request_id: req.id,
                });
            }
        }

        const before = _uniqStrings(existing?.policy?.dependencies || []).map(String);
        const nextTask = {
            ...existing,
            policy: {
                ...(existing.policy || {}),
                dependencies: deps,
            },
            meta: {
                ...(existing.meta || {}),
                id: taskId,
                version: '5.0',
            },
        };

        // ✅ P1-7: Move cycle check INSIDE transaction to prevent race condition
        const tx = db.transaction(() => {
            // Re-check for circular dependencies with exclusive lock held
            if (deps.length > 0) {
                const cycleCheck = _detectDependencyCycle(taskId, deps);
                if (cycleCheck.hasCycle) {
                    throw new Error('CIRCULAR_DEPENDENCY_DETECTED');
                }
            }

            _safeUpdateTask(taskId, { task: nextTask, dependencies: deps });

            recordEvent({
                entityType: 'task',
                entityId: taskId,
                actorType: 'user',
                actorId: req.ip || null,
                eventType: 'TASK_DEPENDENCIES_REPLACED',
                payload: { before, after: deps, request_id: req.id },
                dedupKey: `req:${req.id}:task:${taskId}:deps_replace`,
            });
        });

        try {
            tx();
        } catch (/** @type {any} */ txErr) {
            const _e = /** @type {any} */ (txErr);
            if (txErr && _e.message === 'CIRCULAR_DEPENDENCY_DETECTED') {
                return res.status(400).json({
                    success: false,
                    error: 'Dependência circular detectada',
                    message:
                        'As dependências fornecidas criariam um ciclo no grafo de dependências, o que causaria deadlock.',
                    request_id: req.id,
                });
            }
            throw txErr; // Re-throw unexpected errors
        }

        return res.json({ success: true, task_id: taskId, dependencies: deps, request_id: req.id });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[API_TASKS] Falha ao atualizar dependências: ${_e?.message || String(_e)}`, req.id);
        return res.status(500).json({ success: false, error: 'Falha ao atualizar dependências.', request_id: req.id });
    }
});

/* --------------------------------------------------------------------------
   1.5. ACTIONS (approve/reject/pause/resume/retry)
-------------------------------------------------------------------------- */

router.post('/:id/approve', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const existing = /** @type {any} */ (getTaskById(safeId));
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Task não encontrada', request_id: req.id });
        }
        if (
            String(existing.stage || '')
                .toUpperCase()
                .trim() !== 'PROPOSED'
        ) {
            return res
                .status(409)
                .json({ success: false, error: 'Ação inválida: task não está em PROPOSED', request_id: req.id });
        }

        const updated = _safeUpdateTask(safeId, {
            stage: 'READY',
            status: 'PENDING',
            paused_at_ms: null,
            cancelled_at_ms: null,
            failed_at_ms: null,
        });
        try {
            releaseTaskLock({ taskId: safeId });
        } catch (/** @type {any} */ _) {
            /* ignore */
        }

        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('APPROVE_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        recordEvent({
            entityType: 'task',
            entityId: safeId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'TASK_APPROVED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:task:${safeId}:approve`,
        });

        return res.json({ success: true, task: updated, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao aprovar task: ${_e.message}`, req.id);
        return res.status(500).json({ success: false, error: 'Falha ao aprovar task.', request_id: req.id });
    }
});

router.post('/:id/reject', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const existing = /** @type {any} */ (getTaskById(safeId));
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Task não encontrada', request_id: req.id });
        }
        if (
            String(existing.stage || '')
                .toUpperCase()
                .trim() !== 'PROPOSED'
        ) {
            return res
                .status(409)
                .json({ success: false, error: 'Ação inválida: task não está em PROPOSED', request_id: req.id });
        }

        const updated = _safeUpdateTask(safeId, {
            stage: 'REJECTED',
            status: 'SKIPPED',
            last_error: 'USER_REJECTED',
        });
        try {
            releaseTaskLock({ taskId: safeId });
        } catch (/** @type {any} */ _) {
            /* ignore */
        }

        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('REJECT_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        recordEvent({
            entityType: 'task',
            entityId: safeId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'TASK_REJECTED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:task:${safeId}:reject`,
        });

        return res.json({ success: true, task: updated, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao rejeitar task: ${_e.message}`, req.id);
        return res.status(500).json({ success: false, error: 'Falha ao rejeitar task.', request_id: req.id });
    }
});

router.post('/:id/pause', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const control = await _runTaskControlCommand(req, res, 'TASK_PAUSE', { task_id: safeId });
        if (!control) return;
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('PAUSE_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({ success: true, task: control?.result?.after || null, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao pausar task: ${_e.message}`, req.id);
        res.status(500).json({ success: false, error: 'Falha ao pausar task.', request_id: req.id });
    }
});

router.post('/:id/resume', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const control = await _runTaskControlCommand(req, res, 'TASK_RESUME', { task_id: safeId });
        if (!control) return;
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('RESUME_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({ success: true, task: control?.result?.after || null, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao resumir task: ${_e.message}`, req.id);
        res.status(500).json({ success: false, error: 'Falha ao resumir task.', request_id: req.id });
    }
});

// Alias explícito: desbloquear (equivalente a resume para BLOCKED).
router.post('/:id/unblock', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const control = await _runTaskControlCommand(req, res, 'TASK_UNBLOCK', { task_id: safeId });
        if (!control) return;
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('UNBLOCK_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({ success: true, task: control?.result?.after || null, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao desbloquear task: ${_e.message}`, req.id);
        res.status(500).json({ success: false, error: 'Falha ao desbloquear task.', request_id: req.id });
    }
});

router.post('/:id/retry', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const control = await _runTaskControlCommand(req, res, 'TASK_RETRY', { task_id: safeId });
        if (!control) return;

        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('RETRY_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({ success: true, task: control?.result?.after || null, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao retry task: ${_e.message}`, req.id);
        res.status(500).json({ success: false, error: 'Falha ao retry task.', request_id: req.id });
    }
});

/**
 * DELETE /:id/purge Remoção física (SSOT) — uso administrativo.
 */
router.delete('/:id/purge', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const control = await _runTaskControlCommand(req, res, 'TASK_PURGE', { task_id: safeId });
        if (!control) return;
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('PURGE_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({ success: true, operation: control.operation, request_id: req.id });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao purgar tarefa: ${_e.message}`, req.id);
        res.status(500).json({ success: false, error: 'Falha ao purgar task.', request_id: req.id });
    }
});

/**
 * DELETE /:id Remoção física da intenção de execução.
 */
router.delete('/:id', async (req, res) => {
    try {
        const safeId = _safeId(req.params.id);
        const control = await _runTaskControlCommand(req, res, 'TASK_CANCEL', { task_id: safeId });
        if (!control) return;

        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('DELETE_TASK', { id: safeId, user: 'GUI', request_id: req.id });
        res.json({
            success: true,
            task: control?.result?.after || null,
            request_id: req.id,
        });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao remover tarefa: ${_e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao remover tarefa do disco.',
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   2. OPERAÇÕES EM LOTE (BULK)
-------------------------------------------------------------------------- */

const bulkTasksSchema = z.object({
    ids: z.array(z.string()).min(1).max(500),
    action: z.enum([
        'pause',
        'resume',
        'unblock',
        'retry',
        'cancel',
        'approve',
        'reject',
        'set_stage',
        'set_target',
        'set_priority',
        'set_execute_after',
    ]),
    params: z.record(z.any()).optional(),
});

router.post('/bulk', schemaGuard(bulkTasksSchema), async (req, res) => {
    try {
        const action = String(req.body.action);
        const params = req.body.params || {};

        const ids = _uniqStrings(req.body.ids).map(_safeId).filter(Boolean).slice(0, 500);
        if (ids.length === 0) {
            return res.status(400).json({ success: false, error: 'ids vazio', request_id: req.id });
        }

        const ssotActions = new Set(['pause', 'resume', 'unblock', 'retry', 'cancel']);
        if (ssotActions.has(action)) {
            const control = await _runTaskControlCommand(req, res, 'TASK_BULK_ACTION', {
                ids,
                action,
                params,
            });
            if (!control) return;

            return res.json({
                success: true,
                updated: control?.result?.metadata?.ok || 0,
                failed: control?.result?.metadata?.failed || [],
                metadata: control?.result?.metadata || {},
                request_id: req.id,
            });
        }

        const stageParam = params.stage !== undefined ? String(params.stage).toUpperCase().trim() : null;
        const targetParam = params.target !== undefined ? String(params.target).toLowerCase().trim() : null;
        const priorityParam = params.priority !== undefined ? Number(params.priority) : null;
        const executeAfterParam = params.execute_after_ms !== undefined ? params.execute_after_ms : undefined;

        if (action === 'set_stage' && !stageParam) {
            return res.status(400).json({ success: false, error: 'params.stage é obrigatório', request_id: req.id });
        }
        if (action === 'set_stage' && stageParam && !ALLOWED_TASK_STAGES.has(stageParam)) {
            return res.status(400).json({
                success: false,
                error: 'params.stage inválido',
                details: { allowed: Array.from(ALLOWED_TASK_STAGES) },
                request_id: req.id,
            });
        }
        if (action === 'set_target' && !targetParam) {
            return res.status(400).json({ success: false, error: 'params.target é obrigatório', request_id: req.id });
        }
        if (action === 'set_target' && targetParam && !ALLOWED_TARGETS.has(targetParam)) {
            return res.status(400).json({
                success: false,
                error: 'params.target inválido',
                details: { allowed: Array.from(ALLOWED_TARGETS) },
                request_id: req.id,
            });
        }
        if (action === 'set_priority' && !Number.isFinite(priorityParam)) {
            return res.status(400).json({ success: false, error: 'params.priority inválido', request_id: req.id });
        }
        if (action === 'set_execute_after') {
            if (!(
                executeAfterParam === null ||
                executeAfterParam === undefined ||
                Number.isFinite(Number(executeAfterParam)) ||
                typeof executeAfterParam === 'string'
            )) {
                return res
                    .status(400)
                    .json({ success: false, error: 'params.execute_after_ms inválido', request_id: req.id });
            }
        }

        const updated = /** @type {any[]} */ ([]);
        const failed = [];

        // Prepare all updates first (validate), then apply atomically
        const batch = /** @type {any[]} */ ([]);

        for (const id of ids) {
            try {
                const existing = /** @type {any} */ (getTaskById(id));
                if (!existing) {
                    failed.push({ id, error: 'Task não encontrada' });
                    continue;
                }

                const status = String(existing.unified_status || existing.state?.status || '').toUpperCase();
                const isRunning = status === 'RUNNING';

                const now = Date.now();

                if (
                    isRunning &&
                    [
                        'set_stage',
                        'set_target',
                        'set_priority',
                        'set_execute_after',
                        'approve',
                        'reject',
                        'retry',
                        'resume',
                        'unblock',
                    ].includes(action)
                ) {
                    failed.push({ id, error: 'Task RUNNING: ação não permitida' });
                    continue;
                }

                // If task is actively claimed (lock lease), block edits that would race with imminent execution.
                const lockSnapshot = _getLockSnapshot(id);
                if (
                    status === 'PENDING' &&
                    _isTaskActivelyClaimed(lockSnapshot, now) &&
                    ['set_stage', 'set_target', 'set_priority', 'set_execute_after'].includes(action)
                ) {
                    failed.push({ id, error: 'Task em processamento (claim): pause/cancel antes de editar' });
                    continue;
                }
                if (
                    action === 'approve' &&
                    String(existing.stage || '')
                        .toUpperCase()
                        .trim() !== 'PROPOSED'
                ) {
                    failed.push({ id, error: 'Task não está em PROPOSED' });
                    continue;
                }
                if (
                    action === 'reject' &&
                    String(existing.stage || '')
                        .toUpperCase()
                        .trim() !== 'PROPOSED'
                ) {
                    failed.push({ id, error: 'Task não está em PROPOSED' });
                    continue;
                }

                // Build update payload based on action
                let updatePayload = null;
                let shouldReleaseLock = false;

                if (action === 'pause') {
                    updatePayload = { status: 'PAUSED', paused_at_ms: now };
                } else if (action === 'resume' || action === 'unblock') {
                    updatePayload = {
                        status: 'PENDING',
                        paused_at_ms: null,
                        blocked_reason: null,
                        blocked_at_ms: null,
                        blocked_details_json: null,
                        execute_after_ms: null,
                    };
                    shouldReleaseLock = true;
                } else if (action === 'retry') {
                    updatePayload = {
                        stage: 'READY',
                        status: 'PENDING',
                        attempts: 0,
                        blocked_reason: null,
                        blocked_at_ms: null,
                        blocked_details_json: null,
                        failed_at_ms: null,
                        completed_at_ms: null,
                        cancelled_at_ms: null,
                        paused_at_ms: null,
                        execute_after_ms: null,
                        last_error: null,
                    };
                    shouldReleaseLock = true;
                } else if (action === 'cancel') {
                    updatePayload = { status: 'CANCELLED', cancelled_at_ms: now, last_error: 'USER_CANCELLED' };
                    shouldReleaseLock = true;
                } else if (action === 'approve') {
                    updatePayload = {
                        stage: 'READY',
                        status: 'PENDING',
                        paused_at_ms: null,
                        cancelled_at_ms: null,
                        failed_at_ms: null,
                    };
                    shouldReleaseLock = true;
                } else if (action === 'reject') {
                    updatePayload = { stage: 'REJECTED', status: 'SKIPPED', last_error: 'USER_REJECTED' };
                    shouldReleaseLock = true;
                } else if (action === 'set_stage') {
                    updatePayload = { stage: stageParam };
                } else if (action === 'set_target') {
                    const task = existing;
                    task.spec = task.spec || {};
                    task.spec.target = targetParam;
                    updatePayload = { task };
                } else if (action === 'set_priority') {
                    const task = existing;
                    task.meta = task.meta || {};
                    task.meta.priority = Math.trunc(/** @type {any} */ (priorityParam));
                    updatePayload = { task };
                } else if (action === 'set_execute_after') {
                    const task = existing;
                    task.policy = task.policy || {};

                    let ms = null;
                    if (executeAfterParam === null || executeAfterParam === undefined || executeAfterParam === '') {
                        ms = null;
                    } else if (typeof executeAfterParam === 'string' && !/^\d+$/.test(executeAfterParam.trim())) {
                        const parsed = Date.parse(executeAfterParam);
                        ms = Number.isFinite(parsed) ? parsed : null;
                    } else {
                        const n = Number(executeAfterParam);
                        ms = Number.isFinite(n) ? n : null;
                    }

                    task.policy.execute_after = ms ? new Date(ms).toISOString() : null;
                    updatePayload = { task, execute_after_ms: ms };
                    shouldReleaseLock = ms === null;
                }

                if (!updatePayload) {
                    failed.push({ id, error: 'Ação não reconhecida' });
                    continue;
                }

                // Add to batch for atomic execution
                batch.push({ id, updatePayload, shouldReleaseLock });
            } catch (/** @type {any} */ err) {
                const _e = /** @type {any} */ (err);
                failed.push({ id: ids[ids.indexOf(id)] || 'unknown', error: _e?.message || String(_e) });
            }
        }

        // Apply all updates atomically in a transaction
        if (batch.length > 0) {
            const db = getDb();
            const tx = db.transaction(() => {
                for (const { id, updatePayload } of batch) {
                    const result = _safeUpdateTask(id, updatePayload);
                    if (!result) {
                        // Optimistic locking conflict or task disappeared
                        throw new Error(`Task ${id}: concurrent modification or not found`);
                    }
                    updated.push({ id, task: result });
                }
            });

            try {
                tx();

                // Release locks and record events outside transaction
                for (const { id, shouldReleaseLock } of batch) {
                    if (shouldReleaseLock) {
                        try {
                            releaseTaskLock({ taskId: id });
                        } catch (/** @type {any} */ _) {
                            /* ignore */
                        }
                    }

                    recordEvent({
                        entityType: 'task',
                        entityId: id,
                        actorType: 'user',
                        actorId: req.ip || null,
                        eventType: `TASK_BULK_${action.toUpperCase()}`,
                        payload: { request_id: req.id, params },
                        dedupKey: `req:${req.id}:task:${id}:bulk:${action}`,
                    });
                }
            } catch (/** @type {any} */ txErr) {
                const _e = /** @type {any} */ (txErr);
                // Transaction failed - all updates rolled back
                for (const { id } of batch) {
                    failed.push({ id, error: _e?.message || 'Transaction failed' });
                }
                // Clear any partial success
                updated.length = 0;
            }
        }

        return res.json({ success: true, updated, failed, request_id: req.id });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[API_TASKS] Falha no bulk: ${_e?.message || String(_e)}`, req.id);
        return res.status(500).json({ success: false, error: 'Falha em operação bulk.', request_id: req.id });
    }
});

/**
 * POST /retry-failed Reinicia o ciclo de vida de todas as tarefas com status FAILED.
 */
router.post('/retry-failed', async (req, res) => {
    try {
        const count = retryFailedTasks();
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('RETRY_BATCH', { count, request_id: req.id });
        recordEvent({
            entityType: 'queue',
            entityId: 'global',
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'QUEUE_RETRY_FAILED',
            payload: { request_id: req.id, count },
            dedupKey: `req:${req.id}:queue:retry_failed`,
        });
        res.json({
            success: true,
            count,
            request_id: req.id,
        });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha na reinicialização em lote: ${_e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha na reinicialização em lote.',
            request_id: req.id,
        });
    }
});

/**
 * POST /clear Limpeza higiênica da fila (preserva tarefas em execução).
 */
router.post('/clear', async (req, res) => {
    try {
        const report = clearQueuePreserveRunning();
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await audit('CLEAR_QUEUE', { ...report, request_id: req.id });
        recordEvent({
            entityType: 'queue',
            entityId: 'global',
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'QUEUE_CLEARED',
            payload: { request_id: req.id, report },
            dedupKey: `req:${req.id}:queue:clear`,
        });
        res.json({
            success: true,
            ...report,
            request_id: req.id,
        });
    } catch (/** @type {any} */ e) {
        const _e = /** @type {any} */ (e);
        log('ERROR', `[API_TASKS] Falha ao limpar a fila: ${_e.message}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Falha ao limpar a fila.',
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   3. RESULTS (breaking): /api/tasks/:id agora retorna JSON; downloads em /api/results
-------------------------------------------------------------------------- */

// Back-compat: /api/tasks/results/:id → /api/results/:id
router.get('/results/:id', async (req, res) => {
    const safeId = _safeId(req.params.id);
    const search = new URLSearchParams();
    if (req.query['attempt']) search.set('attempt', String(req.query['attempt']));
    if (req.query['format']) search.set('format', String(req.query['format']));
    if (req.query['disposition']) search.set('disposition', String(req.query['disposition']));
    const qs = search.toString();
    res.redirect(302, `/api/results/${safeId}${qs ? `?${qs}` : ''}`);
});

router.get('/:id/result', async (req, res) => {
    const safeId = _safeId(req.params.id);
    const search = new URLSearchParams();
    if (req.query['attempt']) search.set('attempt', String(req.query['attempt']));
    if (req.query['format']) search.set('format', String(req.query['format']));
    if (req.query['disposition']) search.set('disposition', String(req.query['disposition']));
    const qs = search.toString();
    res.redirect(302, `/api/results/${safeId}${qs ? `?${qs}` : ''}`);
});

// Breaking: GET /api/tasks/:id now returns SSOT task JSON (not results).
router.get('/:id', async (req, res) => {
    try {
        const taskId = _safeId(req.params.id);
        if (['retry-failed', 'clear', 'bulk', 'results'].includes(taskId)) {
            return fail(res, req, 404, {
                code: 'TASK_NOT_FOUND',
                error: 'Task não encontrada',
                details: { task_id: taskId },
            });
        }
        const task = getTaskById(taskId);
        if (!task) {
            return fail(res, req, 404, {
                code: 'TASK_NOT_FOUND',
                error: 'Task não encontrada',
                details: { task_id: taskId },
            });
        }
        ok(res, req, { task }, {});
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[API_TASKS] Falha ao buscar task: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'TASK_GET_FAILED',
            error: 'Falha ao buscar task',
            details: _e?.message || String(_e),
        });
    }
});

export default router;
