// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import * as schemas from '#core/schemas';
import { recordEvent } from '#infra/db/events_repo';
import {
    AUTONOMY_MODES,
    createMission,
    deleteMission,
    getMissionById,
    listMissions,
    MISSION_STATUS,
    updateMission,
} from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';
import { insertTask, TASK_STAGES } from '#infra/db/task_repo';
import {
    cancelMissionTransition,
    executeMissionTransition,
    pauseMissionTransition,
    resumeMissionTransition,
} from '#agent/mission_execution_service';
import { WorkflowGenerator } from '#missions/workflow_generator';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import schemaGuard from '../../middleware/schema_guard.js';

const router = express.Router();

const workflowGenerator = new WorkflowGenerator();

const ALLOWED_TARGETS = new Set(['auto', 'chatgpt', 'gemini', 'claude', 'ollama']);
const AUTONOMY_VALUES = Object.values(AUTONOMY_MODES);
const AUTONOMY_SCHEMA = z.enum(/** @type {[string, ...string[]]} */ (AUTONOMY_VALUES));

const createMissionSchema = z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    templateId: z.string().min(1).max(200).optional().nullable(),
    params: z.record(z.any()).optional(),
    autonomy_mode: AUTONOMY_SCHEMA.optional(),
    autonomyMode: AUTONOMY_SCHEMA.optional(),
    policy: z.record(z.any()).optional(),
});

const patchMissionSchema = z
    .object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(5000).optional(),
        autonomy_mode: AUTONOMY_SCHEMA.optional(),
        autonomyMode: AUTONOMY_SCHEMA.optional(),
    })
    .refine(v => Object.keys(v).length > 0, { message: 'Body vazio' });

const updatePolicySchema = z.object({
    autonomy_mode: AUTONOMY_SCHEMA.optional(),
    autonomyMode: AUTONOMY_SCHEMA.optional(),
    policy: z.record(z.any()).optional(),
});

const feedbackSchema = z.object({
    feedback: z.string().min(1).max(20000),
});

const suggestTasksSchema = z.object({
    max_proposals: z.number().int().min(1).max(25).optional(),
    target: z.string().optional(),
});

const proposalsAcceptSchema = z.object({
    proposals: z
        .array(
            z.object({
                title: z.string().optional(),
                user_message: z.string().min(1),
                system_message: z.string().optional().nullable(),
                target: z.string().optional(),
                priority: z.number().optional(),
                depends_on: z.array(z.string()).optional(),
                tags: z.array(z.string()).optional(),
            })
        )
        .min(1)
        .max(200),
});

const proposalsRejectSchema = z
    .object({
        all: z.boolean().optional(),
        task_ids: z.array(z.string()).max(2000).optional(),
    })
    .refine(v => v.all === true || (Array.isArray(v.task_ids) && v.task_ids.length > 0), {
        message: 'Body inválido: forneça {all:true} ou {task_ids:[...]}',
    });

function _asUpper(value) {
    return value ? String(value).toUpperCase().trim() : null;
}

function _asTrimmedString(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value).trim();
}

function _coerceAutonomyMode(raw) {
    const value = _asUpper(raw);
    if (!value) return AUTONOMY_MODES.USER_ONLY;
    return AUTONOMY_MODES[value] ? value : AUTONOMY_MODES.USER_ONLY;
}

function _computeProgressView(mission) {
    const workflow = mission?.context?.workflow || null;
    const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];

    const progress = mission?.context?.progress || {};
    const currentStepIndex = Number(progress.current_step_index || 0) || 0;

    const totalSteps = steps.length;
    const percent = totalSteps > 0 ? Math.max(0, Math.min(100, Math.round((currentStepIndex / totalSteps) * 100))) : 0;

    return {
        mission_id: mission.id,
        status: mission.status,
        autonomy_mode: mission.autonomy_mode,
        progress: {
            current_step_index: currentStepIndex,
            total_steps: totalSteps,
            percent,
            current_task_id: progress.current_task_id || null,
            created_count: progress.created_count || 0,
            completed: Array.isArray(progress.completed) ? progress.completed : [],
            failed: Array.isArray(progress.failed) ? progress.failed : [],
        },
        current_step: steps[currentStepIndex] || null,
        workflow: workflow ? { id: workflow.id, template_id: workflow.template_id || null } : null,
        is_active: mission.status === MISSION_STATUS.RUNNING,
    };
}

function _pickAllowedTarget(options = /** @type {{requested?: any, allowedTargets?: any}} */ ({})) {
    const { requested, allowedTargets = null } = options;
    const requestedNormalized = requested ? String(requested).toLowerCase().trim() : null;
    const allowed = Array.isArray(allowedTargets) ? allowedTargets.map(t => String(t).toLowerCase().trim()) : null;

    if (requestedNormalized && allowed && allowed.includes(requestedNormalized)) {
        return requestedNormalized;
    }
    if (requestedNormalized && !allowed) {
        return requestedNormalized;
    }

    if (allowed && allowed.length > 0) {
        return allowed[0];
    }
    return 'auto';
}

function _sendTransitionFailure(res, req, result) {
    return res.status(Number(result?.statusCode || 500)).json({
        success: false,
        error: result?.error || 'Falha na transição da missão',
        code: result?.code || 'MISSION_TRANSITION_FAILED',
        details: result?.details || null,
        request_id: req.id,
    });
}

/* --------------------------------------------------------------------------
   0. TEMPLATES
-------------------------------------------------------------------------- */

/**
 * GET /api/missions/templates/list
 */
router.get('/templates/list', async (req, res) => {
    try {
        const templates = await workflowGenerator.listTemplates();
        res.json({
            success: true,
            total: templates.length,
            templates,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao listar templates: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar templates',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   1. CREATE / READ
-------------------------------------------------------------------------- */

/**
 * POST /api/missions
 * Cria nova missão (SSOT SQLite). Se `templateId` for fornecido, gera workflow.
 */
router.post('/', schemaGuard(createMissionSchema), async (req, res) => {
    try {
        const title = _asTrimmedString(req.body?.title, '');
        const description = _asTrimmedString(req.body?.description, '');
        const templateId = req.body?.templateId ? String(req.body.templateId).trim() : null;
        const params = req.body?.params && typeof req.body.params === 'object' ? req.body.params : {};

        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Campos obrigatórios ausentes',
                missing: 'title',
                request_id: req.id,
            });
        }

        const autonomyMode = /** @type {string} */ (
            _coerceAutonomyMode(req.body?.autonomy_mode ?? req.body?.autonomyMode)
        );
        const policy = req.body?.policy && typeof req.body.policy === 'object' ? req.body.policy : {};

        let workflow = null;
        if (templateId) {
            workflow = await workflowGenerator.generateWorkflow(templateId, params);
        }

        const mission = /** @type {any} */ (
            createMission({
                title,
                description,
                autonomy_mode: autonomyMode,
                policy,
                context: {
                    workflow,
                    progress: {
                        current_step_index: 0,
                        current_task_id: null,
                        created_count: 0,
                        completed: [],
                        failed: [],
                    },
                    feedback: [],
                    mission_context: {},
                },
            })
        );

        recordEvent({
            entityType: 'mission',
            entityId: mission.id,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_CREATED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:mission:${mission.id}:created`,
        });

        res.status(201).json({
            success: true,
            mission,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao criar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao criar missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * PATCH /api/missions/:id
 * Atualiza campos básicos (título/descrição/autonomia) para uso no dashboard.
 */
router.patch('/:id', schemaGuard(patchMissionSchema), async (req, res) => {
    try {
        const missionId = String(req.params.id);
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        const title = req.body?.title !== undefined ? _asTrimmedString(req.body.title, '') : undefined;
        const description =
            req.body?.description !== undefined ? _asTrimmedString(req.body.description, '') : undefined;
        const autonomyModeRaw = req.body?.autonomy_mode ?? req.body?.autonomyMode;
        const autonomy_mode = autonomyModeRaw !== undefined ? _coerceAutonomyMode(autonomyModeRaw) : undefined;

        const updated = updateMission(missionId, {
            ...(title !== undefined ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(autonomy_mode !== undefined ? { autonomy_mode } : {}),
        });

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_UPDATED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:mission:${missionId}:updated`,
        });

        res.json({ success: true, mission: updated, request_id: req.id });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao atualizar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao atualizar missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * GET /api/missions
 */
router.get('/', async (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status).toUpperCase().trim() : null;
        const missions = listMissions({ status, limit: 2000 });
        res.json({
            success: true,
            total: missions.length,
            missions,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao listar missões: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao listar missões',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * GET /api/missions/:id
 */
router.get('/:id', async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({
                success: false,
                error: 'Missão não encontrada',
                mission_id: missionId,
                request_id: req.id,
            });
        }
        res.json({
            success: true,
            mission,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao buscar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * GET /api/missions/:id/progress
 */
router.get('/:id/progress', async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({
                success: false,
                error: 'Missão não encontrada',
                mission_id: missionId,
                request_id: req.id,
            });
        }

        res.json({
            success: true,
            progress: _computeProgressView(mission),
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao buscar progresso: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao buscar progresso',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   2. EXECUTION CONTROL
-------------------------------------------------------------------------- */

/**
 * POST /api/missions/:id/execute
 * Missão só entra em RUNNING via ação explícita do usuário.
 */
router.post('/:id/execute', async (req, res) => {
    try {
        const missionId = req.params.id;
        const result = executeMissionTransition({
            missionId,
            actorType: 'user',
            actorId: req.ip || null,
            dedupKey: `req:${req.id}:mission:${missionId}:execute`,
            payload: { request_id: req.id },
        });
        if (!result.ok) {
            return _sendTransitionFailure(res, req, result);
        }

        res.json({
            success: true,
            message: 'Missão iniciada',
            mission: result.mission,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao executar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao executar missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * POST /api/missions/:id/pause
 */
router.post('/:id/pause', async (req, res) => {
    try {
        const missionId = req.params.id;
        const result = pauseMissionTransition({
            missionId,
            actorType: 'user',
            actorId: req.ip || null,
            dedupKey: `req:${req.id}:mission:${missionId}:pause`,
            payload: { request_id: req.id },
        });
        if (!result.ok) {
            return _sendTransitionFailure(res, req, result);
        }

        res.json({
            success: true,
            message: 'Missão pausada',
            mission: result.mission,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao pausar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao pausar missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * POST /api/missions/:id/resume
 */
router.post('/:id/resume', async (req, res) => {
    try {
        const missionId = req.params.id;
        const result = resumeMissionTransition({
            missionId,
            actorType: 'user',
            actorId: req.ip || null,
            dedupKey: `req:${req.id}:mission:${missionId}:resume`,
            payload: { request_id: req.id },
        });
        if (!result.ok) {
            return _sendTransitionFailure(res, req, result);
        }

        res.json({
            success: true,
            message: 'Missão resumida',
            mission: result.mission,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao resumir missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao resumir missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   3. POLICY / AUTONOMY
-------------------------------------------------------------------------- */

/**
 * POST /api/missions/:id/policy
 * Ajusta autonomia/budget em runtime.
 */
router.post('/:id/policy', schemaGuard(updatePolicySchema), async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        const autonomy_mode = _coerceAutonomyMode(
            req.body?.autonomy_mode ?? req.body?.autonomyMode ?? mission.autonomy_mode
        );
        const policy = req.body?.policy && typeof req.body.policy === 'object' ? req.body.policy : null;

        const updated = updateMission(missionId, {
            autonomy_mode,
            ...(policy ? { policy } : {}),
        });

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_POLICY_UPDATED',
            payload: { request_id: req.id, autonomy_mode, has_policy: Boolean(policy) },
            dedupKey: `req:${req.id}:mission:${missionId}:policy`,
        });

        res.json({
            success: true,
            mission: updated,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao atualizar policy: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao atualizar policy',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   4. FEEDBACK
-------------------------------------------------------------------------- */

/**
 * POST /api/missions/:id/feedback
 */
router.post('/:id/feedback', schemaGuard(feedbackSchema), async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        const feedback = _asTrimmedString(req.body?.feedback, '');
        if (!feedback) {
            return res.status(400).json({
                success: false,
                error: 'Feedback inválido',
                message: 'Campo "feedback" é obrigatório e deve ser string',
                request_id: req.id,
            });
        }

        const current = mission.context || {};
        const feedbackList = Array.isArray(current.feedback) ? current.feedback : [];
        const updated = updateMission(missionId, {
            context: {
                ...current,
                feedback: [...feedbackList, { ts_ms: Date.now(), text: feedback }],
            },
        });

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_FEEDBACK_ADDED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:mission:${missionId}:feedback`,
        });

        res.json({
            success: true,
            message: 'Feedback adicionado',
            mission: updated,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao adicionar feedback: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao adicionar feedback',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   5. DYNAMIC PLANNING (LLM → proposals)
-------------------------------------------------------------------------- */

/**
 * POST /api/missions/:id/suggest-tasks
 * Cria uma "planner task" que deve retornar JSON estrito de propostas.
 *
 * Body (opcional):
 *  - max_proposals: number (default 5)
 *  - target: auto|chatgpt|gemini|claude|ollama
 */
router.post('/:id/suggest-tasks', schemaGuard(suggestTasksSchema), async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        if (req.body?.target !== undefined && req.body?.target !== null && req.body?.target !== '') {
            const t = String(req.body.target).toLowerCase().trim();
            if (!ALLOWED_TARGETS.has(t)) {
                return res.status(400).json({
                    success: false,
                    error: 'Target inválido',
                    details: { allowed: Array.from(ALLOWED_TARGETS), provided: t },
                    request_id: req.id,
                });
            }
        }

        if (mission.status !== MISSION_STATUS.RUNNING) {
            return res.status(409).json({
                success: false,
                error: 'Missão não está em execução',
                message: 'Use POST /api/missions/:id/execute antes de sugerir tasks',
                mission_id: missionId,
                request_id: req.id,
            });
        }

        if (mission.autonomy_mode === AUTONOMY_MODES.USER_ONLY) {
            return res.status(409).json({
                success: false,
                error: 'Autonomia insuficiente',
                message: 'Ajuste autonomy_mode para permitir sugestões da LLM (ex.: LLM_SUGGEST).',
                mission_id: missionId,
                request_id: req.id,
            });
        }

        const maxProposals = Math.max(1, Math.min(Number(req.body?.max_proposals || 5) || 5, 25));
        const target = _pickAllowedTarget({
            requested: req.body?.target,
            allowedTargets: mission.policy?.allowed_targets,
        });

        const workflow = mission.context?.workflow || null;
        const progress = mission.context?.progress || {};
        const feedback = Array.isArray(mission.context?.feedback) ? mission.context.feedback : [];

        const plannerContract = {
            proposals: [
                {
                    title: 'string curta',
                    user_message: 'prompt completo',
                    system_message: 'opcional',
                    target: 'auto|chatgpt|gemini|claude|ollama',
                    priority: 0,
                    depends_on: ['task-id-opcional'],
                    tags: ['capitulo-1', 'revisao'],
                },
            ],
            needs_user_input: false,
            questions: [],
            stop_reason: null,
        };

        const userMessage = [
            'Você é um planner de tasks para uma mission.',
            '',
            'Retorne APENAS um JSON válido (sem Markdown, sem texto extra) seguindo exatamente este schema:',
            JSON.stringify(plannerContract, null, 2),
            '',
            `Mission title: ${mission.title}`,
            `Mission description: ${mission.description || ''}`,
            '',
            `Autonomy mode: ${mission.autonomy_mode}`,
            `Max proposals: ${maxProposals}`,
            '',
            `Workflow template_id: ${workflow?.template_id || 'none'}`,
            `Workflow steps: ${Array.isArray(workflow?.steps) ? workflow.steps.length : 0}`,
            `Progress current_step_index: ${progress.current_step_index || 0}`,
            '',
            'Recent feedback (most recent last):',
            JSON.stringify(feedback.slice(-10), null, 2),
            '',
            'Constraints:',
            '- Use target inside allowed_targets when possible.',
            '- Keep prompts self-contained and ready to run.',
            '',
            `Generate up to ${maxProposals} proposals.`,
        ].join('\n');

        const taskId = `task-${uuidv4()}`;
        const nowIso = new Date().toISOString();
        const parentTaskId = progress.current_task_id ? String(progress.current_task_id) : null;
        const correlationId = `req-${req.id}-mission-${missionId}-planner`.replace(/[^a-zA-Z0-9._-]/g, '-');

        const taskV5 = schemas.core.TaskSchemaV5.parse({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: nowIso,
                priority: 10,
                source: 'gui',
                mission_id: missionId,
                workflow_id: workflow?.id || undefined,
                parent_id: parentTaskId || undefined,
                correlation_id: correlationId,
                tags: ['mission_planner'],
            },
            spec: {
                target,
                payload: {
                    system_message: 'Você DEVE retornar APENAS JSON válido. Não use Markdown nem texto fora do JSON.',
                    user_message: userMessage,
                },
            },
            policy: {
                dependencies: [],
                execute_after: null,
            },
            mission: {
                mission_id: missionId,
                step_id: 'planner',
                step_index: 0,
                step_dependencies: [],
                mission_context: mission.context?.mission_context || {},
                is_checkpoint: false,
            },
            state: { status: 'PENDING' },
            result: {},
        });

        insertTask(taskV5, { stage: TASK_STAGES.READY, status: 'PENDING', actor: 'user' });

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_PLANNER_TASK_CREATED',
            payload: { request_id: req.id, planner_task_id: taskId },
            dedupKey: `req:${req.id}:mission:${missionId}:planner_task`,
        });

        res.json({
            success: true,
            mission_id: missionId,
            task_id: taskId,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao criar planner task: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao criar planner task',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * POST /api/missions/:id/proposals/accept
 * Aplique propostas diretamente como tasks READY (execução automática).
 *
 * Body:
 *   { proposals: [ ...plannerContract.proposals... ] }
 */
router.post('/:id/proposals/accept', schemaGuard(proposalsAcceptSchema), async (req, res) => {
    try {
        const missionId = req.params.id;
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        const proposals = Array.isArray(req.body?.proposals) ? req.body.proposals : null;
        if (!proposals) {
            return res
                .status(400)
                .json({ success: false, error: 'Body inválido: "proposals" é obrigatório', request_id: req.id });
        }

        const workflow = mission.context?.workflow || null;
        const nowIso = new Date().toISOString();

        /** @type {string[]} */
        const createdTaskIds = [];

        for (const proposal of proposals.slice(0, 200)) {
            const user_message = _asTrimmedString(proposal?.user_message, '');
            if (!user_message) continue;

            const taskId = `task-${uuidv4()}`;
            const target = _pickAllowedTarget({
                requested: proposal?.target,
                allowedTargets: mission.policy?.allowed_targets,
            });

            const taskV5 = schemas.core.TaskSchemaV5.parse({
                meta: {
                    id: taskId,
                    version: '5.0',
                    created_at: nowIso,
                    priority: Number.isFinite(Number(proposal?.priority)) ? Number(proposal.priority) : 5,
                    source: 'gui',
                    mission_id: missionId,
                    workflow_id: workflow?.id || undefined,
                    parent_id: mission.context?.progress?.current_task_id
                        ? String(mission.context.progress.current_task_id)
                        : undefined,
                    correlation_id: `req-${req.id}-mission-${missionId}-proposal-${taskId}`.replace(
                        /[^a-zA-Z0-9._-]/g,
                        '-'
                    ),
                    tags: Array.isArray(proposal?.tags) ? proposal.tags.map(t => String(t)) : [],
                },
                spec: {
                    target,
                    payload: {
                        system_message: _asTrimmedString(proposal?.system_message, ''),
                        user_message,
                    },
                },
                policy: {
                    dependencies: Array.isArray(proposal?.depends_on) ? proposal.depends_on.map(d => String(d)) : [],
                    execute_after: null,
                },
                mission: {
                    mission_id: missionId,
                    step_id: null,
                    step_index: 0,
                    step_dependencies: [],
                    mission_context: mission.context?.mission_context || {},
                    is_checkpoint: false,
                },
                state: { status: 'PENDING' },
                result: {},
            });

            insertTask(taskV5, { stage: TASK_STAGES.READY, status: 'PENDING', actor: 'user' });
            createdTaskIds.push(taskId);
        }

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_PROPOSALS_ACCEPTED',
            payload: { request_id: req.id, created: createdTaskIds.length, task_ids: createdTaskIds },
            dedupKey: `req:${req.id}:mission:${missionId}:proposals_accept`,
        });

        res.json({
            success: true,
            mission_id: missionId,
            created: createdTaskIds.length,
            task_ids: createdTaskIds,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao aceitar proposals: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao aceitar proposals',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * POST /api/missions/:id/proposals/reject
 * Rejeita proposals (tasks em stage=PROPOSED) de uma mission.
 *
 * Body:
 *  - { all: true } ou { task_ids: string[] }
 */
router.post('/:id/proposals/reject', schemaGuard(proposalsRejectSchema), async (req, res) => {
    try {
        const missionId = String(req.params.id);
        const mission = getMissionById(missionId);
        if (!mission) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        const now = Date.now();
        const all = Boolean(req.body?.all);
        const taskIdsRaw = Array.isArray(req.body?.task_ids) ? req.body.task_ids : null;
        const taskIds = taskIdsRaw
            ? taskIdsRaw.map(t => String(t).replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean)
            : [];

        const db = getDb();
        /** @type {string[]} */
        let ids = [];
        if (all) {
            ids = db
                .prepare(
                    `SELECT id FROM tasks WHERE mission_id = @mission_id AND stage = 'PROPOSED' ORDER BY created_at_ms ASC LIMIT 2000`
                )
                .all({ mission_id: missionId })
                .map(r => String(r.id));
        } else {
            ids = taskIds.slice(0, 2000);
        }

        if (ids.length === 0) {
            return res.json({ success: true, mission_id: missionId, rejected: 0, task_ids: [], request_id: req.id });
        }

        const placeholders = ids.map(() => '?').join(',');
        const belongs = db
            .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders}) AND mission_id = ?`)
            .all(...ids, missionId)
            .map(r => String(r.id));

        const belongsSet = new Set(belongs);
        const rejectedIds = ids.filter(id => belongsSet.has(id));

        if (rejectedIds.length === 0) {
            return res.json({ success: true, mission_id: missionId, rejected: 0, task_ids: [], request_id: req.id });
        }
        // Update via stmt (clear and stable for better-sqlite3).
        const tx2 = db.transaction(() => {
            const stmt = db.prepare(
                `
                UPDATE tasks
                SET stage = 'REJECTED',
                    status = 'SKIPPED',
                    updated_at_ms = @now,
                    last_error = COALESCE(last_error, 'USER_REJECTED')
                WHERE id = @id
                  AND mission_id = @mission_id
                  AND stage = 'PROPOSED'
            `
            );
            for (const id of rejectedIds) {
                stmt.run({ id, mission_id: missionId, now });
            }
        });
        tx2();

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_PROPOSALS_REJECTED',
            payload: { request_id: req.id, rejected: rejectedIds.length, task_ids: rejectedIds },
            dedupKey: `req:${req.id}:mission:${missionId}:proposals_reject`,
        });
        for (const tid of rejectedIds.slice(0, 5000)) {
            recordEvent({
                entityType: 'task',
                entityId: tid,
                actorType: 'user',
                actorId: req.ip || null,
                eventType: 'TASK_PROPOSAL_REJECTED',
                payload: { request_id: req.id, mission_id: missionId },
                dedupKey: `req:${req.id}:task:${tid}:proposal_reject`,
            });
        }

        res.json({
            success: true,
            mission_id: missionId,
            rejected: rejectedIds.length,
            task_ids: rejectedIds,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao rejeitar proposals: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao rejeitar proposals',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/* --------------------------------------------------------------------------
   6. DELETE / CANCEL
-------------------------------------------------------------------------- */

/**
 * DELETE /api/missions/:id
 * Cancelamento lógico (preserva SSOT e evita tasks órfãs).
 */
router.delete('/:id', async (req, res) => {
    try {
        const missionId = req.params.id;
        const result = cancelMissionTransition({
            missionId,
            actorType: 'user',
            actorId: req.ip || null,
            dedupKey: `req:${req.id}:mission:${missionId}:cancel`,
            payload: { request_id: req.id },
        });
        if (!result.ok) {
            return _sendTransitionFailure(res, req, result);
        }

        res.json({
            success: true,
            message: 'Missão cancelada',
            mission: result.mission,
            request_id: req.id,
        });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao cancelar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({
            success: false,
            error: 'Erro ao cancelar missão',
            details: err?.message || String(err),
            request_id: req.id,
        });
    }
});

/**
 * DELETE /api/missions/:id/purge
 * Remoção física (uso administrativo).
 */
router.delete('/:id/purge', async (req, res) => {
    try {
        const missionId = req.params.id;
        const removed = deleteMission(missionId);
        if (!removed) {
            return res.status(404).json({ success: false, error: 'Missão não encontrada', request_id: req.id });
        }

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'user',
            actorId: req.ip || null,
            eventType: 'MISSION_PURGED',
            payload: { request_id: req.id },
            dedupKey: `req:${req.id}:mission:${missionId}:purge`,
        });
        res.json({ success: true, request_id: req.id });
    } catch (err) {
        log('ERROR', `[MISSIONS_API] Erro ao purgar missão: ${err?.message || String(err)}`, req.id);
        res.status(500).json({ success: false, error: 'Erro ao purgar missão', request_id: req.id });
    }
});

/**
 * Controlador de API para missões
 *
 * **Side-effects:** Registra rotas Express para operações CRUD de missões.
 * **Semântica:** Gerencia ciclo de vida completo de missões, incluindo criação, listagem, atualização e exclusão.
 * **Unidades:** N/A
 *
 * @type {import('express').Router}
 */
export default router;

function setMissionManager(_) {
    log('WARN', '[MISSIONS_API] setMissionManager() ignored (SSOT missions controller)');
}

/**
 * @deprecated Legacy hook (filesystem MissionManager injection).
 * Define gerenciador de missões (compatibilidade legado).
 *
 * **Side-effects:** Log de aviso sobre depreciação.
 * **Semântica:** Interface legado mantida para compatibilidade, mas ignorada.
 * **Unidades:** N/A
 *
 * @param {*} _ - Parâmetro ignorado (interface legado)
 */
export { setMissionManager };
