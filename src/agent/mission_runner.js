// @ts-check - Type checking rigoroso habilitado (arquivo core)
import {
    completeMissionTransition,
    failMissionTransition,
    pauseMissionTransition,
    updateMissionProgressState,
} from '#agent/mission_execution_service';
import { log } from '#core/logger';
import * as schemas from '#core/schemas';
import { recordEvent } from '#infra/db/events_repo';
import { getMissionById, listMissions, MISSION_STATUS } from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';
import { insertTask, TASK_STAGES } from '#infra/db/task_repo';
import crypto from 'node:crypto';

/**
 * @typedef {object} MissionRunnerOptions
 * @property {number} [intervalMs=1000] - Intervalo entre ticks em ms. Default is `1000`
 */

/**
 * @typedef {object} MissionProgress
 * @property {number} current_step_index - Índice do passo atual.
 * @property {string | null} current_task_id - ID da tarefa atual.
 * @property {string[]} completed - IDs de tarefas completadas.
 * @property {string[]} failed - IDs de tarefas falhadas.
 * @property {number} [created_count] - Contador de tarefas criadas.
 * @property {string} [last_step_id] - ID do último passo executado.
 * @property {number} [last_step_index] - Índice do último passo executado.
 */

/**
 * @typedef {object} MissionContext
 * @property {object} [workflow] - Workflow da missão.
 * @property {object[]} [workflow.steps] - Passos do workflow.
 * @property {MissionProgress} [progress] - Progresso da missão.
 * @property {object} [mission_context] - Contexto da missão.
 * @property {string} [target] - Target padrão.
 */

/**
 * @typedef {object} MissionPolicy
 * @property {number} [max_tasks_total] - Máximo de tarefas totais.
 */

/**
 * @param {any} ms
 */
function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {any} obj
 * @param {any} fallback
 */
function _safeJson(obj, fallback) {
    try {
        return structuredClone(obj);
    } catch (/** @type {any} */ _) {
        return fallback;
    }
}

/**
 * @param {any} input
 */
function _hashId(input) {
    return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex').slice(0, 20);
}

/**
 * Executor de missões com workflow automatizado. Processa missões em execução, cria tarefas para cada passo do
 * workflow. Side-effects: Atualiza status de missões, cria tarefas no banco, loga progresso.
 */
class MissionRunner {
    /**
     * Cria uma nova instância do executor de missões.
     *
     * @param {MissionRunnerOptions} [options] - Opções de configuração.
     */
    constructor({ intervalMs = 1000 } = {}) {
        this.intervalMs = Math.max(200, Number(intervalMs) || 1000);
        this._timer = null;
        this._running = false;
        this._stopped = false;
    }

    /**
     * Inicia o processamento contínuo de missões. Side-effects: Inicia timer, loga início.
     *
     * @returns {void}
     */
    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[MissionRunner] started (interval=${this.intervalMs}ms)`);
    }

    /**
     * Para o processamento de missões. Side-effects: Para timer, loga parada.
     *
     * @returns {void}
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[MissionRunner] stopped');
    }

    /**
     * Executa um ciclo de processamento de missões. Processa todas as missões em execução, evitando concorrência.
     * Side-effects: Processa missões, cria tarefas, atualiza status.
     *
     * @returns {Promise<void>} Não retorna valor.
     * @throws {Error} Nunca lança erro - opera em modo fail-safe.
     */
    async tick() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const missions = listMissions({ status: MISSION_STATUS.RUNNING, limit: 200 });
            for (const mission of missions) {
                try {
                    await this._processMission(mission.id);
                } catch (/** @type {any} */ _rawErr) {
                    const err = /** @type {any} */ (_rawErr);
                    log(
                        'WARN',
                        `[MissionRunner] mission ${mission.id} processing failed: ${err?.message || String(err)}`,
                    );
                }
                await _sleep(0);
            }
        } finally {
            this._running = false;
        }
    }

    /**
     * Processa uma missão específica. Avança workflow, cria tarefas, atualiza progresso.
     *
     * @param {string} missionId - ID da missão a processar.
     * @returns {Promise<void>} Não retorna valor.
     * @throws {Error} Nunca lança erro - opera em modo fail-safe.
     */
    async _processMission(missionId) {
        const mission = getMissionById(missionId);
        if (!mission) return;
        if (mission.status !== MISSION_STATUS.RUNNING) return;

        const context = mission.context || {};
        const workflow = context.workflow;
        // Missions can be "open-ended" (no workflow). In that case, MissionRunner
        // does not force completion/failure — tasks can be created manually (dashboard/LLM).
        if (!workflow || !Array.isArray(workflow.steps)) {
            return;
        }
        if (workflow.steps.length === 0) {
            return;
        }

        const progress = context.progress || {
            current_step_index: 0,
            current_task_id: null,
            completed: [],
            failed: [],
        };
        const policy = mission.policy || {};

        const maxTasks = Number(policy.max_tasks_total || 200) || 200;
        const createdCount = Number(progress.created_count || 0) || 0;
        if (createdCount >= maxTasks) {
            const failResult = failMissionTransition({
                missionId,
                failureReason: 'Mission task budget exceeded',
                contextPatch: { progress },
                actorType: 'system',
                dedupKey: `mission:${missionId}:budget_exceeded`,
                payload: { max_tasks_total: maxTasks, created_count: createdCount },
            });
            if (!failResult.ok) {
                log('WARN', `[MissionRunner] failMissionTransition rejected: ${failResult.code || failResult.error}`);
            }
            return;
        }

        // If there is an active task, wait for terminal status.
        if (progress.current_task_id) {
            const db = getDb();
            const row = /** @type {any} */ (
                db.prepare('SELECT status FROM tasks WHERE id = ?').get(progress.current_task_id)
            );
            const status = row?.status || null;

            // BUG-MISSION-NULL-TASK: task deleted/purged — do not loop forever treating null as "in progress"
            if (!status) {
                const nextProgress = {
                    ...progress,
                    failed: Array.isArray(progress.failed)
                        ? [...progress.failed, progress.current_task_id]
                        : [progress.current_task_id],
                    current_task_id: null,
                };
                const failResult = failMissionTransition({
                    missionId,
                    failureReason: `Task ${progress.current_task_id} not found (deleted or purged)`,
                    contextPatch: { progress: nextProgress },
                    expectedProgress: { currentTaskId: progress.current_task_id },
                    actorType: 'system',
                    dedupKey: `mission:${missionId}:task_not_found:${progress.current_task_id}`,
                    payload: { task_id: progress.current_task_id, task_status: null },
                });
                if (!failResult.ok) {
                    log(
                        'WARN',
                        `[MissionRunner] fail (task_not_found) rejected: ${failResult.code || failResult.error}`,
                    );
                }
                return;
            }

            if (status === 'PENDING' || status === 'RUNNING') {
                // still in progress
                return;
            }

            // BUG-MISSION-PAUSED-TASK: task paused individually while mission is RUNNING →
            // cascade-pause the mission so it doesn't loop forever. User must resume mission to continue.
            if (status === 'PAUSED') {
                const pauseResult = pauseMissionTransition({
                    missionId,
                    actorType: 'system',
                    dedupKey: `mission:${missionId}:task_paused_cascade:${progress.current_task_id}`,
                    payload: { task_id: progress.current_task_id, task_status: status, reason: 'TASK_PAUSED_CASCADE' },
                });
                if (!pauseResult.ok && pauseResult.code !== 'MISSION_TRANSITION_NOOP') {
                    log(
                        'WARN',
                        `[MissionRunner] pause (task_paused_cascade) rejected: ${pauseResult.code || pauseResult.error}`,
                    );
                }
                return;
            }

            if (status === 'DONE') {
                const nextProgress = {
                    ...progress,
                    completed: Array.isArray(progress.completed)
                        ? [...progress.completed, progress.current_task_id]
                        : [progress.current_task_id],
                    current_task_id: null,
                    current_step_index: Number(progress.current_step_index || 0) + 1,
                };

                const progressResult = updateMissionProgressState(
                    /** @type {any} */ ({
                        missionId,
                        progress: nextProgress,
                        expectedProgress: { currentTaskId: progress.current_task_id },
                        actorType: 'system',
                        dedupKey: `mission:${missionId}:task_done:${progress.current_task_id}`,
                        payload: {
                            task_id: progress.current_task_id,
                            task_status: status,
                        },
                    }),
                );
                if (!progressResult.ok) {
                    log(
                        'WARN',
                        `[MissionRunner] progress update rejected: ${progressResult.code || progressResult.error}`,
                    );
                }
                return;
            }

            // BUG-MISSION-BLOCKED: task BLOCKED means it needs user action (unblock/retry).
            // Failing the mission immediately is wrong — pause the mission so the user can fix the task.
            if (status === 'BLOCKED') {
                const pauseResult = pauseMissionTransition({
                    missionId,
                    actorType: 'system',
                    dedupKey: `mission:${missionId}:task_blocked_pause:${progress.current_task_id}`,
                    payload: { task_id: progress.current_task_id, task_status: status, reason: 'TASK_BLOCKED' },
                });
                if (!pauseResult.ok && pauseResult.code !== 'MISSION_TRANSITION_NOOP') {
                    log(
                        'WARN',
                        `[MissionRunner] pause (task_blocked) rejected: ${pauseResult.code || pauseResult.error}`,
                    );
                }
                return;
            }

            // Terminal but not DONE: FAILED, CANCELLED, SKIPPED, etc.
            const nextProgress = {
                ...progress,
                failed: Array.isArray(progress.failed)
                    ? [...progress.failed, progress.current_task_id]
                    : [progress.current_task_id],
                current_task_id: null,
            };

            const failResult = failMissionTransition({
                missionId,
                failureReason: `Task ${progress.current_task_id} ended with ${status}`,
                contextPatch: { progress: nextProgress },
                expectedProgress: { currentTaskId: progress.current_task_id },
                actorType: 'system',
                dedupKey: `mission:${missionId}:task_terminal_failure:${progress.current_task_id}`,
                payload: { task_id: progress.current_task_id, task_status: status },
            });
            if (!failResult.ok) {
                log('WARN', `[MissionRunner] fail transition rejected: ${failResult.code || failResult.error}`);
            }
            return;
        }

        const currentStepIndex = Number(progress.current_step_index || 0) || 0;
        if (currentStepIndex >= workflow.steps.length) {
            const doneResult = completeMissionTransition({
                missionId,
                contextPatch: { progress: { ...progress, current_task_id: null } },
                actorType: 'system',
                dedupKey: `mission:${missionId}:completed`,
                payload: { total_steps: workflow.steps.length },
            });
            if (!doneResult.ok) {
                log('WARN', `[MissionRunner] complete transition rejected: ${doneResult.code || doneResult.error}`);
            }
            return;
        }

        const step = workflow.steps[currentStepIndex];
        const stepId = step?.id || `step-${currentStepIndex}`;
        const parentTaskId =
            Array.isArray(progress.completed) && progress.completed.length > 0
                ? String(progress.completed[progress.completed.length - 1])
                : null;

        const attemptSeqByStep =
            progress?.step_attempt_seq && typeof progress.step_attempt_seq === 'object'
                ? progress.step_attempt_seq
                : {};
        const currentAttemptSeq = Number(attemptSeqByStep[stepId] || 0) || 0;
        const nextAttemptSeq = Math.max(1, currentAttemptSeq + 1);
        const deterministicSeed = `${missionId}|${stepId}|${nextAttemptSeq}`;
        const taskId = `task-${_hashId(deterministicSeed)}`;
        const correlationId = `corr-${_hashId(`mission|${missionId}|${stepId}|${nextAttemptSeq}`)}`;
        const nowIso = new Date().toISOString();

        const userMessage =
            step?.prompt_template || step?.description || step?.name || `Execute mission step ${currentStepIndex + 1}`;

        const target = step?.target || context?.target || 'chatgpt';

        const taskV5 = schemas.core.TaskSchemaV5.parse({
            meta: {
                id: taskId,
                version: '5.0',
                created_at: nowIso,
                priority: 8,
                source: 'flow_manager',
                mission_id: missionId,
                workflow_id: workflow.id,
                parent_id: parentTaskId || undefined,
                correlation_id: correlationId,
                tags: ['mission_step'],
            },
            spec: {
                target: String(target).toLowerCase(),
                payload: {
                    system_message: '',
                    user_message: String(userMessage),
                    context: _safeJson(context.mission_context || {}, {}),
                },
                execution: step?.execution || undefined,
                validation: step?.validation || undefined,
            },
            policy: {
                dependencies: [],
                execute_after: null,
            },
            mission: {
                mission_id: missionId,
                step_id: String(stepId),
                step_index: currentStepIndex,
                step_dependencies: Array.isArray(step?.dependencies) ? step.dependencies : [],
                mission_context: _safeJson(context.mission_context || {}, {}),
                is_checkpoint: Boolean(step?.is_checkpoint || false),
            },
            state: {
                status: 'PENDING',
            },
            result: {},
        });

        const db = getDb();
        const existingTask = /** @type {any} */ (db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId));
        insertTask(taskV5, { stage: TASK_STAGES.READY, status: 'PENDING', actor: 'system', ifNotExists: true });

        recordEvent({
            entityType: 'mission',
            entityId: missionId,
            actorType: 'system',
            eventType: 'MISSION_STEP_TASK_ENQUEUED',
            payload: {
                task_id: taskId,
                step_id: stepId,
                step_index: currentStepIndex,
                workflow_id: workflow.id || null,
                attempt_seq: nextAttemptSeq,
                if_not_exists: true,
                reused_existing_task: Boolean(existingTask?.id),
            },
            dedupKey: `mission:${missionId}:step_task:${stepId}:${nextAttemptSeq}`,
        });

        const nextProgress = {
            ...progress,
            current_task_id: taskId,
            created_count: existingTask?.id ? createdCount : createdCount + 1,
            last_step_id: stepId,
            last_step_index: currentStepIndex,
            step_attempt_seq: {
                ...attemptSeqByStep,
                [stepId]: nextAttemptSeq,
            },
        };

        const progressResult = updateMissionProgressState(
            /** @type {any} */ ({
                missionId,
                progress: nextProgress,
                expectedProgress: { currentTaskId: progress.current_task_id, currentStepIndex },
                actorType: 'system',
                dedupKey: `mission:${missionId}:step_progress:${stepId}:${nextAttemptSeq}`,
                payload: {
                    task_id: taskId,
                    step_id: stepId,
                    step_index: currentStepIndex,
                },
            }),
        );
        if (!progressResult.ok) {
            log('WARN', `[MissionRunner] step progress rejected: ${progressResult.code || progressResult.error}`);
        }
    }
}

/**
 * Classe executora de missões com workflow automatizado.
 *
 * @type {typeof MissionRunner}
 */
export { MissionRunner };
