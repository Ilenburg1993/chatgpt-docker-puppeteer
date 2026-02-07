// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { v4 as uuidv4 } from 'uuid';
import * as logger from '#core/logger';
import { MissionStateManager, MISSION_STATUS } from './mission_state_manager.js';
import { WorkflowGenerator } from './workflow_generator.js';
import { ActionCode, MessageType } from '#shared/nerv/constants';
import { ContextManager } from '#orchestrator/context_manager';
import { FeedbackProcessor } from './feedback_processor.js';
import { CheckpointManager } from '#orchestrator/checkpoint_manager';

/**
 * MissionManager - Gerencia ciclo de vida de missões.
 */
class MissionManager {
    /**
     * @param {Object} deps
     * @param {Object} deps.kernel - Instância do Kernel (para executar tasks)
     * @param {Object} deps.nerv - Instância do NERV (para escutar eventos)
     * @param {Object} [deps.stateManager] - MissionStateManager (opcional, cria se não fornecido)
     * @param {Object} [deps.workflowGenerator] - WorkflowGenerator (opcional)
     * @param {Object} [deps.contextManager] - ContextManager (opcional)
     * @param {Object} [deps.feedbackProcessor] - FeedbackProcessor (opcional)
     * @param {Object} [deps.checkpointManager] - CheckpointManager (opcional)
     */
    constructor({ kernel, nerv, stateManager = null, workflowGenerator = null, contextManager = null, feedbackProcessor = null, checkpointManager = null }) {
        if (!kernel) {
            throw new Error('MissionManager requer Kernel');
        }
        if (!nerv) {
            throw new Error('MissionManager requer NERV');
        }

        this.kernel = kernel;
        this.nerv = nerv;
        this.stateManager = stateManager || new MissionStateManager();
        this.workflowGenerator = workflowGenerator || new WorkflowGenerator();
        this.contextManager = contextManager || new ContextManager();
        this.feedbackProcessor = feedbackProcessor || new FeedbackProcessor({ contextManager: this.contextManager });
        this.checkpointManager = checkpointManager || new CheckpointManager();

        // Cache de missões em execução: mission_id → { currentStepIndex, taskIds }
        this.activeMissions = new Map();

        // Setup listeners NERV
        this._setupListeners();

        logger.log('INFO', '[MissionManager] Inicializado com ContextManager, FeedbackProcessor e CheckpointManager');
    }

    /**
     * Inicializa o MissionManager.
     *
     * Realiza crash recovery automático:
     * - Busca missões em estado RUNNING
     * - Se tiverem checkpoints, recupera do último checkpoint
     * - Retoma execução do step onde parou
     */
    async initialize() {
        await this.stateManager.initialize();

        // Crash recovery: Recupera missões interrompidas
        await this._recoverCrashedMissions();

        logger.log('INFO', '[MissionManager] Inicializado com sucesso (crash recovery executado)');
    }

    /* ===========================
       CRUD OPERATIONS
    =========================== */

    /**
     * Cria uma nova missão.
     *
     * @param {Object} options
     * @param {string} options.title - Título da missão
     * @param {string} options.description - Descrição
     * @param {string} options.templateId - ID do template (ex: 'book_writing')
     * @param {Object} options.params - Parâmetros para o template
     * @returns {Promise<Object>} - State da missão criada
     */
    async createMission({ title, description, templateId, params }) {
        // 1. Valida entrada
        if (!title || !templateId) {
            throw new Error('Title e templateId são obrigatórios');
        }

        // 2. Gera workflow a partir do template
        logger.log('INFO', `[MissionManager] Gerando workflow: template=${templateId}`);
        const workflow = await this.workflowGenerator.generateWorkflow(templateId, params);

        // 3. Cria missão no filesystem
        const missionId = `mission-${uuidv4()}`;

        const mission = {
            id: missionId,
            title,
            description,
            workflow,
            config: {
                template: templateId,
                params
            }
        };

        const state = await this.stateManager.createMission(mission);

        // Inicializa contexto para a missão
        this.contextManager.initializeContext(missionId, {
            metadata: {
                template: templateId,
                params
            }
        });

        logger.log('INFO', `[MissionManager] Missão criada: ${missionId} (${workflow.steps.length} steps)`);
        return state;
    }

    /**
     * Lê uma missão.
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<Object|null>} - State ou null
     */
    async getMission(missionId) {
        return this.stateManager.getMission(missionId);
    }

    /**
     * Lista todas as missões.
     *
     * @param {Object} filters - Filtros opcionais
     * @returns {Promise<Object[]>} - Array de states
     */
    async listMissions(filters = {}) {
        return this.stateManager.listMissions(filters);
    }

    /**
     * Deleta uma missão.
     *
     * @param {string} missionId - ID da missão
     */
    async deleteMission(missionId) {
        // Remove do cache se estiver ativa
        this.activeMissions.delete(missionId);

        await this.stateManager.deleteMission(missionId);
        logger.log('INFO', `[MissionManager] Missão deletada: ${missionId}`);
    }

    /* ===========================
       EXECUTION OPERATIONS
    =========================== */

    /**
     * Inicia execução de uma missão.
     *
     * Fluxo:
     * 1. Carrega state da missão
     * 2. Identifica próximo step a executar
     * 3. Gera Task V5 baseado no step
     * 4. Envia task para Kernel
     * 5. Aguarda conclusão via NERV events
     * 6. Repete para próximo step
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<void>}
     */
    async executeMission(missionId) {
        const state = await this.getMission(missionId);
        if (!state) {
            throw new Error(`Mission ${missionId} não encontrada`);
        }

        // Verifica se já está running
        if (state.status === MISSION_STATUS.RUNNING) {
            logger.log('WARN', `[MissionManager] Missão ${missionId} já está em execução`);
            return;
        }

        // Atualiza status para RUNNING
        await this.stateManager.updateMission(missionId, {
            status: MISSION_STATUS.RUNNING
        });

        logger.log('INFO', `[MissionManager] Iniciando execução: ${missionId}`);

        // Registra no cache de missões ativas
        this.activeMissions.set(missionId, {
            currentStepIndex: state.progress.current_step,
            taskIds: []
        });

        // Executa primeiro step
        await this._executeNextStep(missionId);
    }

    /**
     * Pausa execução de uma missão.
     *
     * @param {string} missionId - ID da missão
     */
    async pauseMission(missionId) {
        const state = await this.getMission(missionId);
        if (!state) {
            throw new Error(`Mission ${missionId} não encontrada`);
        }

        if (state.status !== MISSION_STATUS.RUNNING) {
            logger.log('WARN', `[MissionManager] Missão ${missionId} não está running`);
            return;
        }

        // Atualiza status
        await this.stateManager.updateMission(missionId, {
            status: MISSION_STATUS.PAUSED
        });

        // Remove do cache (tasks em andamento continuarão, mas próximos steps não serão iniciados)
        this.activeMissions.delete(missionId);

        logger.log('INFO', `[MissionManager] Missão pausada: ${missionId}`);
    }

    /**
     * Resume execução de uma missão pausada.
     *
     * @param {string} missionId - ID da missão
     */
    async resumeMission(missionId) {
        const state = await this.getMission(missionId);
        if (!state) {
            throw new Error(`Mission ${missionId} não encontrada`);
        }

        if (state.status !== MISSION_STATUS.PAUSED) {
            logger.log('WARN', `[MissionManager] Missão ${missionId} não está pausada`);
            return;
        }

        // Atualiza status e retoma execução
        await this.stateManager.updateMission(missionId, {
            status: MISSION_STATUS.RUNNING
        });

        this.activeMissions.set(missionId, {
            currentStepIndex: state.progress.current_step,
            taskIds: []
        });

        logger.log('INFO', `[MissionManager] Missão resumida: ${missionId}`);

        // Continua execução
        await this._executeNextStep(missionId);
    }

    /**
     * Adiciona feedback a uma missão.
     *
     * O feedback será processado, categorizado e armazenado no MemoryStore.
     * Será injetado nos próximos steps executados.
     *
     * @param {string} missionId - ID da missão
     * @param {string} feedback - Feedback textual
     * @returns {Promise<Object>} Feedback processado
     */
    async addFeedback(missionId, feedback) {
        const mission = await this.getMission(missionId);
        if (!mission) {
            throw new Error(`Mission ${missionId} não encontrada`);
        }

        // Processa feedback com FeedbackProcessor
        const processed = this.feedbackProcessor.processFeedback(feedback, {
            mission_id: missionId,
            step_id: mission.workflow.steps[mission.progress.current_step]?.id
        });

        // Salva feedback processado no state
        await this.stateManager.addFeedback(missionId, feedback, {
            processed_id: processed.id,
            category: processed.category,
            action_items: processed.actionItems,
            patterns: processed.patterns
        });

        logger.log('INFO', `[MissionManager] Feedback processado e adicionado: ${missionId} (${processed.category}, ${processed.actionItems.length} action items, ${processed.patterns.length} patterns)`);

        return processed;
    }

    /**
     * Retorna progresso da missão.
     *
     * @param {string} missionId - ID da missão
     * @returns {Promise<Object>} - Objeto com progresso
     */
    async getMissionProgress(missionId) {
        const state = await this.getMission(missionId);
        if (!state) {
            return null;
        }

        return {
            mission_id: missionId,
            status: state.status,
            progress: state.progress,
            current_step: state.workflow.steps[state.progress.current_step],
            is_active: this.activeMissions.has(missionId)
        };
    }

    /* ===========================
       INTERNAL HELPERS
    =========================== */

    /**
     * Executa próximo step da missão.
     */
    async _executeNextStep(missionId) {
        const state = await this.getMission(missionId);
        if (!state) {
            logger.log('ERROR', `[MissionManager] Missão ${missionId} não encontrada ao executar step`);
            return;
        }

        // Verifica se missão foi pausada
        if (state.status === MISSION_STATUS.PAUSED) {
            logger.log('INFO', `[MissionManager] Missão ${missionId} foi pausada, parando execução`);
            return;
        }

        const { workflow, progress } = state;
        const currentStepIndex = progress.current_step;

        // Verifica se completou todos os steps
        if (currentStepIndex >= workflow.steps.length) {
            await this._completeMission(missionId);
            return;
        }

        const step = workflow.steps[currentStepIndex];

        logger.log('INFO', `[MissionManager] Executando step ${currentStepIndex + 1}/${workflow.steps.length}: ${step.id}`);

        // Gera Task V5 baseado no step
        const taskV5 = this._generateTaskV5FromStep(step, state);

        // Gera correlationId
        const correlationId = `mission-${missionId}-step-${currentStepIndex}`;

        // Cacheia taskId para tracking
        const missionCache = this.activeMissions.get(missionId);
        if (missionCache) {
            missionCache.taskIds.push(taskV5.meta.id);
        }

        // Envia task para Kernel
        try {
            await this.kernel.executeTask(taskV5, correlationId);
            logger.log('DEBUG', `[MissionManager] Task enviada: ${taskV5.meta.id}`);
        } catch (error) {
            logger.log('ERROR', `[MissionManager] Erro ao enviar task: ${error.message}`);
            await this._failMission(missionId, error.message);
        }
    }

    /**
     * Gera Task V5 a partir de um step do workflow.
     */
    _generateTaskV5FromStep(step, missionState) {
        const taskId = `task-${uuidv4()}`;

        // Extrai prompt do step (pode estar em prompt_template ou payload)
        const userMessage = step.prompt_template || step.description || 'Execute this step';

        // Obtém contexto acumulado de steps anteriores
        const context = this.contextManager.getContextForStep(missionState.id, step.id);

        // Monta prompt com contexto
        let finalPrompt = userMessage;

        // Adiciona summary de contexto (se houver)
        if (context && context.summary) {
            finalPrompt += `\n\n[CONTEXT SUMMARY]:\n${context.summary}`;
        }

        // Adiciona outputs de steps recentes (se houver)
        if (context && context.steps && context.steps.length > 0) {
            const recentOutputs = context.steps
                .map((s) => `Step ${s.step_id}: ${s.output.substring(0, 300)}...`)
                .join('\n');
            finalPrompt += `\n\n[RECENT STEPS]:\n${recentOutputs}`;
        }

        // Injeta feedback da missão usando FeedbackProcessor (se houver)
        if (missionState.feedback.length > 0) {
            const latestFeedback = missionState.feedback[missionState.feedback.length - 1];

            // Se feedback foi processado, usa versão processada; senão, processa agora
            let processedFeedback;
            if (latestFeedback.metadata && latestFeedback.metadata.processed_id) {
                // Reconstroi objeto processado a partir do metadata
                processedFeedback = {
                    id: latestFeedback.metadata.processed_id,
                    original: latestFeedback.content,
                    normalized: latestFeedback.content.toLowerCase().trim(),
                    category: latestFeedback.metadata.category || 'GENERAL',
                    actionItems: latestFeedback.metadata.action_items || [],
                    patterns: latestFeedback.metadata.patterns || []
                };
            } else {
                // Processa feedback agora (fallback para feedback antigo)
                processedFeedback = this.feedbackProcessor.processFeedback(latestFeedback.content, {
                    mission_id: missionState.id,
                    step_id: step.id
                });
            }

            // Injeta usando FeedbackProcessor (formato estruturado)
            finalPrompt = this.feedbackProcessor.injectIntoStep(finalPrompt, processedFeedback, {
                format: 'structured',
                includeCategory: true,
                includeActionItems: true
            });
        }

        // Monta Task V5
        const taskV5 = {
            meta: {
                id: taskId,
                version: '5.0',
                created_at: new Date().toISOString(),
                priority: 8,
                source: 'mission',
                mission_id: missionState.id,
                workflow_id: missionState.workflow.id,
                step_id: step.id
            },
            spec: {
                target: 'chatgpt', // Default, pode ser configurável
                payload: {
                    user_message: finalPrompt
                },
                execution: step.execution || { strategy: 'SINGLE_SHOT' },
                validation: step.validation || { validators: [] }
            },
            state: {
                status: 'pending',
                created_at: new Date().toISOString(),
                history: []
            },
            policy: {
                max_cost_cents: 500, // TODO: calcular baseado em estimate
                dependencies: []
            }
        };

        return taskV5;
    }

    /**
     * Handler: Task completada com sucesso.
     */
    async _handleTaskCompleted(missionId, stepIndex, taskId, result) {
        logger.log('INFO', `[MissionManager] Task completada: ${taskId} (mission=${missionId}, step=${stepIndex})`);

        const state = await this.getMission(missionId);
        if (!state) {
            return;
        }

        const step = state.workflow.steps[stepIndex];

        // Salva output do step
        if (result && result.output) {
            await this.stateManager.saveOutput(missionId, step.id, result.output);

            // Adiciona output ao contexto acumulado
            await this.contextManager.addStepOutput(missionId, step.id, result.output);
        }

        // Atualiza progresso
        const updatedProgress = {
            ...state.progress,
            current_step: stepIndex + 1,
            completed_tasks: state.progress.completed_tasks + 1,
            percent: Math.round(((stepIndex + 1) / state.workflow.steps.length) * 100)
        };

        await this.stateManager.updateMission(missionId, {
            progress: updatedProgress
        });

        // Salva checkpoint completo da missão (crash recovery)
        const updatedState = await this.getMission(missionId);
        await this.checkpointManager.saveCheckpoint(missionId, stepIndex + 1, updatedState, {
            reason: 'step_completed',
            task_id: taskId,
            step_id: step.id
        });

        // Executa próximo step
        await this._executeNextStep(missionId);
    }

    /**
     * Handler: Task falhou.
     */
    async _handleTaskFailed(missionId, stepIndex, taskId, error) {
        logger.log('ERROR', `[MissionManager] Task falhou: ${taskId} (mission=${missionId}, step=${stepIndex})`);

        await this._failMission(missionId, `Task ${taskId} falhou: ${error}`);
    }

    /**
     * Recupera missões interrompidas (crash recovery).
     *
     * Busca missões em estado RUNNING e tenta recuperar do último checkpoint.
     */
    async _recoverCrashedMissions() {
        try {
            const allMissions = await this.stateManager.listMissions();

            for (const mission of allMissions) {
                // Apenas missões RUNNING podem precisar de recovery
                if (mission.status !== MISSION_STATUS.RUNNING) {
                    continue;
                }

                // Verifica se tem checkpoint
                const hasCheckpoint = await this.checkpointManager.hasCheckpoint(mission.id);
                if (!hasCheckpoint) {
                    continue;
                }

                // Carrega último checkpoint
                const checkpoint = await this.checkpointManager.loadCheckpoint(mission.id);
                if (!checkpoint) {
                    continue;
                }

                logger.log('INFO', `[MissionManager] 🔄 Recovering mission ${mission.id} from checkpoint (step ${checkpoint.step_index})`);

                // Restaura estado da missão a partir do checkpoint
                // (Não precisa fazer nada além de logar, o checkpoint já está salvo)

                // Retoma execução a partir do step checkpoint
                this.activeMissions.set(mission.id, {
                    currentStepIndex: checkpoint.step_index,
                    taskIds: []
                });

                // Continua execução
                await this._executeNextStep(mission.id);

                logger.log('INFO', `[MissionManager] ✅ Mission ${mission.id} recovered and resumed`);
            }
        } catch (error) {
            logger.log('ERROR', `[MissionManager] Error during crash recovery: ${error.message}`);
        }
    }

    /**
     * Marca missão como completada.
     */
    async _completeMission(missionId) {
        await this.stateManager.updateMission(missionId, {
            status: MISSION_STATUS.COMPLETED
        });

        this.activeMissions.delete(missionId);

        // Limpa contexto (mas mantém memory store)
        this.contextManager.clearContext(missionId);

        // Limpa checkpoints (não são mais necessários após conclusão)
        await this.checkpointManager.deleteAllCheckpoints(missionId);

        logger.log('INFO', `[MissionManager] ✅ Missão COMPLETADA: ${missionId}`);
    }

    /**
     * Marca missão como failed.
     */
    async _failMission(missionId, reason) {
        await this.stateManager.updateMission(missionId, {
            status: MISSION_STATUS.FAILED,
            failure_reason: reason
        });

        this.activeMissions.delete(missionId);

        // Limpa contexto
        this.contextManager.clearContext(missionId);

        // Limpa checkpoints
        await this.checkpointManager.deleteAllCheckpoints(missionId);

        logger.log('ERROR', `[MissionManager] ❌ Missão FAILED: ${missionId} - ${reason}`);
    }

    /**
     * Setup listeners NERV para eventos de conclusão de tasks.
     */
    _setupListeners() {
        this.nerv.onReceive(envelope => {
            if (envelope.kind !== MessageType.EVENT) {
                return;
            }

            const { actionCode, payload } = envelope;

            // Filtra apenas tasks que pertencem a missões
            if (!payload || !payload.task || !payload.task.meta || !payload.task.meta.mission_id) {
                return;
            }

            const missionId = payload.task.meta.mission_id;
            const taskId = payload.task.meta.id;

            // Identifica step index (parse de step_id)
            // Ex: step_id = "step-2-chapter-5" → pega índice do workflow
            const stepId = payload.task.meta.step_id;
            const stepIndex = this._findStepIndex(missionId, stepId);

            if (stepIndex === -1) {
                logger.log('WARN', `[MissionManager] Step ${stepId} não encontrado na missão ${missionId}`);
                return;
            }

            // DRIVER_TASK_COMPLETED
            if (actionCode === ActionCode.DRIVER_TASK_COMPLETED) {
                this._handleTaskCompleted(missionId, stepIndex, taskId, payload.result);
            }

            // DRIVER_TASK_FAILED
            if (actionCode === ActionCode.DRIVER_TASK_FAILED) {
                this._handleTaskFailed(missionId, stepIndex, taskId, payload.error);
            }
        });

        logger.log('DEBUG', '[MissionManager] NERV listeners configurados');
    }

    /**
     * Helper: Encontra índice do step no workflow.
     */
    _findStepIndex(missionId, stepId) {
        const missionCache = this.activeMissions.get(missionId);
        if (!missionCache) {
            return -1;
        }

        // Se stepId não fornecido, retorna índice corrente
        if (!stepId) return missionCache.currentStepIndex;

        // Se houver lista de steps no cache, tenta localizar pelo step_id
        if (Array.isArray(missionCache.steps)) {
            const idx = missionCache.steps.findIndex(s => s.step_id === stepId || s.id === stepId);
            if (idx >= 0) return idx;
        }

        // Fallback: retorna currentStepIndex se não encontrar
        return missionCache.currentStepIndex;
    }

    /**
     * Cleanup - Para de escutar eventos.
     */
    cleanup() {
        this.activeMissions.clear();
        this.contextManager.cleanup();
        logger.log('INFO', '[MissionManager] Cleanup completo');
    }
}

export { MissionManager, MISSION_STATUS };
