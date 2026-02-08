// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import { ActionCode, MessageType } from '#shared/nerv/constants';
import { getActionCode, getCorrelationId, getMessageType, getPayload } from '#shared/nerv/envelope_reader';

/**
 * TaskExecutionOrchestrator - Orquestra execução de tasks V5.
 *
 * Fluxo:
 * 1. executeTask(task) → beforeExecution() → emit DRIVER_EXECUTE_TASK
 * 2. Escuta DRIVER_TASK_COMPLETED/FAILED
 * 3. afterExecution() → decisão (DONE/RETRY/NEXT_STEP)
 * 4. Processa decisão via KernelNERVBridge
 */
class TaskExecutionOrchestrator {
    /**
     * @param {Object} params
     * @param {Object} params.nerv - Instância do NERV
     * @param {Object} params.nervBridge - KernelNERVBridge
     */
    constructor({
        nerv,
        nervBridge,
        onTaskRetryRequested = null,
        onTaskPermanentFailure = null,
        onTaskCompleted = null
    }) {
        if (!nerv) {
            throw new Error('TaskExecutionOrchestrator requer NERV');
        }
        if (!nervBridge) {
            throw new Error('TaskExecutionOrchestrator requer KernelNERVBridge');
        }

        this.nerv = nerv;
        this.nervBridge = nervBridge;
        this.onTaskRetryRequested = onTaskRetryRequested;
        this.onTaskPermanentFailure = onTaskPermanentFailure;
        this.onTaskCompleted = onTaskCompleted;

        // Cache de execuções em andamento: task_id → { task, correlationId, startedAt }
        this.activeExecutions = new Map();

        // task_id → Set<eventType> já processados (idempotência)
        this.processedExecutionEvents = new Map();

        this.unsubscribeNerv = null;

        // Setup de listeners NERV
        this._setupListeners();

        logger.log('INFO', '[TaskExecutionOrchestrator] Inicializado');
    }

    /**
     * Executa uma task (ponto de entrada).
     * @param {Object} task - Task V5
     * @param {string} correlationId - ID de correlação NERV
     */
    async executeTask(task, correlationId) {
        if (!task || !task.meta || !task.meta.id) {
            throw new Error('Task inválida');
        }

        const taskId = task.meta.id;

        logger.log('INFO', `[TaskExecutionOrchestrator] Iniciando execução: ${taskId}`, correlationId);

        // 1. Hook: beforeExecution (orchestrator prepara task)
        const preparedTask = this.nervBridge.beforeTaskExecution(task);

        // 2. Cacheia task completa + correlationId para afterExecution
        this.activeExecutions.set(taskId, {
            task: preparedTask,
            correlationId,
            startedAt: Date.now()
        });

        // 3. Emite comando para Driver executar task
        this.nervBridge.emitCommand({
            target: 'driver',
            correlationId,
            payload: {
                actionCode: ActionCode.DRIVER_EXECUTE_TASK,
                task: preparedTask
            }
        });

        logger.log('DEBUG', `[TaskExecutionOrchestrator] Task enviada para driver: ${taskId}`, correlationId);
    }

    /**
     * Configura listeners NERV para eventos de conclusão.
     */
    _setupListeners() {
        // Escuta eventos do Driver
        this.unsubscribeNerv = this.nerv.onReceive(envelope => {
            if (getMessageType(envelope) !== MessageType.EVENT) {
                return;
            }

            const actionCode = getActionCode(envelope);
            const payload = getPayload(envelope);
            const correlationId = getCorrelationId(envelope);

            // DRIVER_TASK_COMPLETED
            if (actionCode === ActionCode.DRIVER_TASK_COMPLETED) {
                this._handleTaskCompleted(payload, correlationId);
            }

            // DRIVER_TASK_FAILED
            if (actionCode === ActionCode.DRIVER_TASK_FAILED) {
                this._handleTaskFailed(payload, correlationId);
            }

            if (actionCode === ActionCode.DRIVER_TASK_QUEUED) {
                this._handleTaskQueued(payload, correlationId);
            }
        });

        logger.log('DEBUG', '[TaskExecutionOrchestrator] Listeners configurados');
    }

    /**
     * Handler: Task completada com sucesso.
     */
    async _handleTaskCompleted(payload, correlationId) {
        const { taskId, result } = payload;

        // Recupera task do cache
        const cached = this.activeExecutions.get(taskId);
        if (!cached) {
            // Task não estava sendo orquestrada (pode ser V1.x ou external)
            return;
        }

        const processed = this.processedExecutionEvents.get(taskId) || new Set();
        if (processed.has('COMPLETED') || processed.has('FAILED')) {
            logger.log('WARN', `[TaskExecutionOrchestrator] Evento duplicado ignorado para ${taskId}`, correlationId);
            return;
        }
        processed.add('COMPLETED');
        this.processedExecutionEvents.set(taskId, processed);

        const task = cached.task;
        const executionDuration = Date.now() - cached.startedAt;

        logger.log(
            'INFO',
            `[TaskExecutionOrchestrator] Task completada: ${taskId} (${executionDuration}ms)`,
            correlationId
        );

        // Hook: afterExecution (orchestrator decide próxima ação)
        const decision = await this.nervBridge.afterTaskExecution(task, result);

        logger.log('DEBUG', `[TaskExecutionOrchestrator] Decisão: ${decision.action} para task ${taskId}`, correlationId);

        // Processa decisão
        await this.nervBridge.processOrchestrationDecision(decision, correlationId);

        // Remove do cache se DONE
        if (decision.action === 'DONE') {
            if (typeof this.onTaskCompleted === 'function') {
                await this.onTaskCompleted({
                    taskId,
                    correlationId,
                    decision
                });
            }
            this.activeExecutions.delete(taskId);
            this.processedExecutionEvents.delete(taskId);
        }
    }

    /**
     * Handler: Task falhou.
     */
    async _handleTaskFailed(payload, correlationId) {
        const { taskId } = payload;
        const error = payload?.error || payload?.reason || 'Unknown task failure';

        const cached = this.activeExecutions.get(taskId);
        if (!cached) {
            return;
        }

        const processed = this.processedExecutionEvents.get(taskId) || new Set();
        if (processed.has('FAILED') || processed.has('COMPLETED')) {
            logger.log('WARN', `[TaskExecutionOrchestrator] Evento duplicado ignorado para ${taskId}`, correlationId);
            return;
        }
        processed.add('FAILED');
        this.processedExecutionEvents.set(taskId, processed);

        logger.log('ERROR', `[TaskExecutionOrchestrator] Task falhou: ${taskId} - ${error}`, correlationId);

        const retryable = payload?.retryable === true;
        const suggestedDelayMs = Number(payload?.suggestedDelayMs || payload?.retryDelayMs || 0) || 0;
        const nextAction = payload?.next_action || (retryable ? 'RETRY_LATER' : 'ABORT');

        if (retryable && typeof this.onTaskRetryRequested === 'function') {
            await this.onTaskRetryRequested({
                taskId,
                correlationId,
                delayMs: suggestedDelayMs,
                reason: payload?.reason || error,
                nextAction,
                payload
            });
        } else if (typeof this.onTaskPermanentFailure === 'function') {
            await this.onTaskPermanentFailure({
                taskId,
                correlationId,
                reason: payload?.reason || error,
                payload
            });
        }

        // Por ora, apenas removemos do cache
        // Em implementação completa, poderíamos tentar retry baseado em policy
        this.activeExecutions.delete(taskId);
        this.processedExecutionEvents.delete(taskId);

        // Emite evento de falha
        this.nervBridge.emitEvent({
            target: null, // broadcast
            correlationId,
            payload: {
                actionCode: ActionCode.TASK_FAILED,
                taskId,
                error,
                reason: payload?.reason || null,
                retryable,
                next_action: nextAction,
                suggestedDelayMs,
                errorType: payload?.errorType || null,
                operation: payload?.operation || null
            }
        });
    }

    _handleTaskQueued(payload, correlationId) {
        const taskId = payload?.taskId;
        if (!taskId) {
            return;
        }

        logger.log('INFO', `[TaskExecutionOrchestrator] Task queued by driver: ${taskId}`, correlationId);
    }

    /**
     * Cleanup - Para de escutar eventos.
     */
    cleanup() {
        this.activeExecutions.clear();
        this.processedExecutionEvents.clear();
        if (this.unsubscribeNerv) {
            this.unsubscribeNerv();
            this.unsubscribeNerv = null;
        }
        logger.log('INFO', '[TaskExecutionOrchestrator] Cleanup completo');
    }
}

export { TaskExecutionOrchestrator };
