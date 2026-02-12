// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import * as schemas from '#core/schemas';
import { getMissionById, listMissions, MISSION_STATUS, updateMission } from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';
import { insertTask, TASK_STAGES } from '#infra/db/task_repo';
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {Object} MissionRunnerOptions
 * @property {number} [intervalMs=1000] - Intervalo entre ticks em ms.
 */

/**
 * @typedef {Object} MissionProgress
 * @property {number} current_step_index - Índice do passo atual.
 * @property {string|null} current_task_id - ID da tarefa atual.
 * @property {string[]} completed - IDs de tarefas completadas.
 * @property {string[]} failed - IDs de tarefas falhadas.
 * @property {number} [created_count] - Contador de tarefas criadas.
 * @property {string} [last_step_id] - ID do último passo executado.
 * @property {number} [last_step_index] - Índice do último passo executado.
 */

/**
 * @typedef {Object} MissionContext
 * @property {Object} [workflow] - Workflow da missão.
 * @property {Object[]} [workflow.steps] - Passos do workflow.
 * @property {MissionProgress} [progress] - Progresso da missão.
 * @property {Object} [mission_context] - Contexto da missão.
 * @property {string} [target] - Target padrão.
 */

/**
 * @typedef {Object} MissionPolicy
 * @property {number} [max_tasks_total] - Máximo de tarefas totais.
 */

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function _safeJson(obj, fallback) {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (_) {
        return fallback;
    }
}

/**
 * Executor de missões com workflow automatizado.
 * Processa missões em execução, cria tarefas para cada passo do workflow.
 * Side-effects: Atualiza status de missões, cria tarefas no banco, loga progresso.
 */
class MissionRunner {
    /**
     * Cria uma nova instância do executor de missões.
     * @param {MissionRunnerOptions} [options] - Opções de configuração.
     */
    constructor({ intervalMs = 1000 } = {}) {
        this.intervalMs = Math.max(200, Number(intervalMs) || 1000);
        this._timer = null;
        this._running = false;
        this._stopped = false;
    }

    /**
     * Inicia o processamento contínuo de missões.
     * Side-effects: Inicia timer, loga início.
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
     * Para o processamento de missões.
     * Side-effects: Para timer, loga parada.
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
     * Executa um ciclo de processamento de missões.
     * Processa todas as missões em execução, evitando concorrência.
     * Side-effects: Processa missões, cria tarefas, atualiza status.
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
                } catch (err) {
                    log(
                        'WARN',
                        `[MissionRunner] mission ${mission.id} processing failed: ${err?.message || String(err)}`
                    );
                }
                await _sleep(0);
            }
        } finally {
            this._running = false;
        }
    }

    /**
     * Processa uma missão específica.
     * Avança workflow, cria tarefas, atualiza progresso.
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
            updateMission(missionId, {
                status: MISSION_STATUS.FAILED,
                completed_at_ms: Date.now(),
                context: { ...context, progress, failure_reason: 'Mission task budget exceeded' },
            });
            return;
        }

        // If there is an active task, wait for terminal status.
        if (progress.current_task_id) {
            const db = getDb();
            const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(progress.current_task_id);
            const status = row?.status || null;

            if (!status || status === 'PENDING' || status === 'RUNNING' || status === 'PAUSED') {
                // still in progress
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

                updateMission(missionId, {
                    context: { ...context, progress: nextProgress },
                });
                return;
            }

            // Terminal but not DONE
            const nextProgress = {
                ...progress,
                failed: Array.isArray(progress.failed)
                    ? [...progress.failed, progress.current_task_id]
                    : [progress.current_task_id],
                current_task_id: null,
            };

            updateMission(missionId, {
                status: MISSION_STATUS.FAILED,
                completed_at_ms: Date.now(),
                context: {
                    ...context,
                    progress: nextProgress,
                    failure_reason: `Task ${progress.current_task_id} ended with ${status}`,
                },
            });
            return;
        }

        const currentStepIndex = Number(progress.current_step_index || 0) || 0;
        if (currentStepIndex >= workflow.steps.length) {
            updateMission(missionId, {
                status: MISSION_STATUS.DONE,
                completed_at_ms: Date.now(),
                context: { ...context, progress: { ...progress, current_task_id: null } },
            });
            return;
        }

        const step = workflow.steps[currentStepIndex];
        const stepId = step?.id || `step-${currentStepIndex}`;

        const taskId = `task-${uuidv4()}`;
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

        insertTask(taskV5, { stage: TASK_STAGES.READY, status: 'PENDING', actor: 'system' });

        const nextProgress = {
            ...progress,
            current_task_id: taskId,
            created_count: createdCount + 1,
            last_step_id: stepId,
            last_step_index: currentStepIndex,
        };

        updateMission(missionId, { context: { ...context, progress: nextProgress } });
    }
}

/**
 * Classe executora de missões com workflow automatizado.
 * @type {typeof MissionRunner}
 */
export { MissionRunner };
