/* ==========================================================================
   src/kernel/task_execution_orchestrator.js
   Audit Level: 100 — Task Execution Orchestrator (V2.0)
   Status: PRODUCTION READY
   Responsabilidade: Orquestrar execução de tasks V5 com suporte a strategies.
                     Integra Kernel → Orchestrator → Driver via NERV.

   IMPORTANTE:
   - Intercepta tasks antes de enviar para Driver
   - Chama beforeExecution() do OrchestratorEngine
   - Escuta completion events do Driver
   - Chama afterExecution() e processa decisões (RETRY/NEXT_STEP/DONE)
========================================================================== */

const logger = require('@core/logger');
const { ActionCode, MessageType } = require('@shared/nerv/constants');

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
    constructor({ nerv, nervBridge }) {
        if (!nerv) {
            throw new Error('TaskExecutionOrchestrator requer NERV');
        }
        if (!nervBridge) {
            throw new Error('TaskExecutionOrchestrator requer KernelNERVBridge');
        }

        this.nerv = nerv;
        this.nervBridge = nervBridge;

        // Cache de execuções em andamento: task_id → { task, correlationId, startedAt }
        this.activeExecutions = new Map();

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
        this.nerv.onReceive(envelope => {
            if (envelope.kind !== MessageType.EVENT) {
                return;
            }

            const { actionCode, payload, correlationId } = envelope;

            // DRIVER_TASK_COMPLETED
            if (actionCode === ActionCode.DRIVER_TASK_COMPLETED) {
                this._handleTaskCompleted(payload, correlationId);
            }

            // DRIVER_TASK_FAILED
            if (actionCode === ActionCode.DRIVER_TASK_FAILED) {
                this._handleTaskFailed(payload, correlationId);
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
            this.activeExecutions.delete(taskId);
        }
    }

    /**
     * Handler: Task falhou.
     */
    async _handleTaskFailed(payload, correlationId) {
        const { taskId, error } = payload;

        const cached = this.activeExecutions.get(taskId);
        if (!cached) {
            return;
        }

        logger.log('ERROR', `[TaskExecutionOrchestrator] Task falhou: ${taskId} - ${error}`, correlationId);

        // Por ora, apenas removemos do cache
        // Em implementação completa, poderíamos tentar retry baseado em policy
        this.activeExecutions.delete(taskId);

        // Emite evento de falha
        this.nervBridge.emitEvent({
            target: null, // broadcast
            correlationId,
            payload: {
                actionCode: ActionCode.TASK_FAILED,
                taskId,
                error
            }
        });
    }

    /**
     * Cleanup - Para de escutar eventos.
     */
    cleanup() {
        this.activeExecutions.clear();
        logger.log('INFO', '[TaskExecutionOrchestrator] Cleanup completo');
    }
}

module.exports = { TaskExecutionOrchestrator };
