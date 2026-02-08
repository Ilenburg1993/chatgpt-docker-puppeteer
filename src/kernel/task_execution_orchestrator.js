// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import { ActionCode, MessageType } from '#shared/nerv/constants';
import { getActionCode, getCorrelationId, getMessageType, getPayload } from '#shared/nerv/envelope_reader';

/**
 * @typedef {{ meta: { id: string }, spec?: Record<string, unknown> }} TaskV5
 * @typedef {{ action?: string, [key: string]: unknown }} OrchestrationDecision
 * @typedef {{ taskId?: string, result?: unknown }} DriverTaskCompletedPayload
 * @typedef {{ taskId?: string, error?: string, reason?: string, retryable?: boolean, suggestedDelayMs?: number, retryDelayMs?: number, next_action?: string, [key: string]: unknown }} DriverTaskFailedPayload
 * @typedef {{ task: TaskV5, correlationId: string|null, startedAt: number }} ActiveExecutionEntry
 * @typedef {'COMPLETED'|'FAILED'} ProcessedEventType
 * @typedef {{ correlationId: string|null, processed: Set<ProcessedEventType> }} ExecutionIdempotencyState
 * @typedef {(input: { taskId: string, correlationId: string|null, delayMs?: number, reason: string, nextAction?: string, payload?: Record<string, unknown> }) => Promise<void>|void} TaskRetryRequestedCallback
 * @typedef {(input: { taskId: string, correlationId: string|null, reason: string, payload?: Record<string, unknown> }) => Promise<void>|void} TaskPermanentFailureCallback
 * @typedef {(input: { taskId: string, correlationId: string|null, decision: OrchestrationDecision }) => Promise<void>|void} TaskCompletedCallback
 */


/**
 * TaskExecutionOrchestrator - Orquestra execução de tasks V5.
 *
 * Fluxo:
 * 1. executeTask(task) → beforeExecution() → emit DRIVER_EXECUTE_TASK
 * 2. Escuta DRIVER_TASK_COMPLETED/FAILED/QUEUED
 * 3. afterExecution() → decisão (DONE/RETRY/NEXT_STEP)
 * 4. Processa decisão via KernelNERVBridge
 *
 * Requisitos / invariantes:
 * - Idempotência por (taskId + correlationId) para evitar duplo processamento por redelivery.
 * - Eventos atrasados/stale (correlationId antigo) são ignorados.
 * - Multi-step / retry: executeTask() reinicializa a janela de idempotência.
 */
class TaskExecutionOrchestrator {
    /**
     * @param {Object} params
     * @param {Object} params.nerv - Instância do NERV
     * @param {Object} params.nervBridge - KernelNERVBridge
     * @param {TaskRetryRequestedCallback|null} [params.onTaskRetryRequested] - callback retry
     * @param {TaskPermanentFailureCallback|null} [params.onTaskPermanentFailure] - callback failure permanente
     * @param {TaskCompletedCallback|null} [params.onTaskCompleted] - callback conclusão
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

        /** @type {Map<string, ActiveExecutionEntry>} Cache de execuções em andamento */
        this.activeExecutions = new Map();

        /**
         * Idempotência por execução:
         * taskId → { correlationId: string|null, processed: Set<'COMPLETED'|'FAILED'> }
         */
        /** @type {Map<string, ExecutionIdempotencyState>} */
        this.processedExecutionEvents = new Map();

        this.unsubscribeNerv = null;

        this._setupListeners();

        logger.log('INFO', '[TaskExecutionOrchestrator] Inicializado');
    }

    /**
     * Executa uma task (ponto de entrada).
     * @param {TaskV5} task - Task V5
     * @param {string|null} correlationId - ID de correlação NERV
     */
    async executeTask(task, correlationId) {
        if (!task?.meta?.id) {
            throw new Error('Task inválida');
        }

        const taskId = task.meta.id;

        logger.log('INFO', `[TaskExecutionOrchestrator] Iniciando execução: ${taskId}`, correlationId);

        // Reinicia janela de idempotência para esta nova dispatch (retry / next-step etc)
        this.processedExecutionEvents.set(taskId, {
            correlationId: correlationId || null,
            processed: new Set()
        });

        let preparedTask;
        try {
            // Hook: beforeExecution (orchestrator prepara task)
            preparedTask = this.nervBridge.beforeTaskExecution(task);
        } catch (err) {
            const msg = err?.message || String(err);
            logger.log('ERROR', `[TaskExecutionOrchestrator] beforeTaskExecution falhou: ${taskId} - ${msg}`, correlationId);

            // Trata como falha permanente (pré-dispatch)
            if (typeof this.onTaskPermanentFailure === 'function') {
                await this.onTaskPermanentFailure({
                    taskId,
                    correlationId,
                    reason: `beforeTaskExecution failed: ${msg}`,
                    payload: { taskId, error: msg, reason: 'BEFORE_EXECUTION_FAILED', retryable: false }
                });
            }

            // Não mantém estado ativo (evita leak)
            this.activeExecutions.delete(taskId);
            this.processedExecutionEvents.delete(taskId);
            return;
        }

        // Cacheia task completa + correlationId para afterExecution
        this.activeExecutions.set(taskId, {
            task: preparedTask,
            correlationId: correlationId || null,
            startedAt: Date.now()
        });

        // Emite comando para Driver executar task
        try {
            this.nervBridge.emitCommand({
                target: 'driver',
                correlationId,
                payload: {
                    actionCode: ActionCode.DRIVER_EXECUTE_TASK,
                    task: preparedTask
                }
            });
        } catch (err) {
            const msg = err?.message || String(err);
            logger.log('ERROR', `[TaskExecutionOrchestrator] emitCommand falhou: ${taskId} - ${msg}`, correlationId);

            if (typeof this.onTaskRetryRequested === 'function') {
                await this.onTaskRetryRequested({
                    taskId,
                    correlationId,
                    delayMs: 250,
                    reason: `emitCommand failed: ${msg}`,
                    nextAction: 'RETRY_LATER',
                    payload: { taskId, error: msg, reason: 'EMIT_COMMAND_FAILED', retryable: true, suggestedDelayMs: 250 }
                });
            } else if (typeof this.onTaskPermanentFailure === 'function') {
                await this.onTaskPermanentFailure({
                    taskId,
                    correlationId,
                    reason: `emitCommand failed: ${msg}`,
                    payload: { taskId, error: msg, reason: 'EMIT_COMMAND_FAILED', retryable: false }
                });
            }

            // Limpa estado para evitar “execução fantasma”
            this.activeExecutions.delete(taskId);
            this.processedExecutionEvents.delete(taskId);
            return;
        }

        logger.log('DEBUG', `[TaskExecutionOrchestrator] Task enviada para driver: ${taskId}`, correlationId);
    }

    /**
     * Configura listeners NERV para eventos do Driver.
     */
    _setupListeners() {
        // Se por algum motivo já existir subscription, evita duplicar.
        if (this.unsubscribeNerv) {
            try {
                this.unsubscribeNerv();
            } catch (unsubscribeError) {
                logger.log('WARN', `[TaskExecutionOrchestrator] Falha ao remover listener anterior: ${unsubscribeError?.message || String(unsubscribeError)}`);
            }
            this.unsubscribeNerv = null;
        }

        const maybeUnsub = this.nerv.onReceive(envelope => {
            if (getMessageType(envelope) !== MessageType.EVENT) {
                return;
            }

            const actionCode = getActionCode(envelope);
            const payload = getPayload(envelope);

            let correlationId = null;
            try {
                correlationId = getCorrelationId(envelope) || null;
            } catch (correlationReadError) {
                logger.log('DEBUG', `[TaskExecutionOrchestrator] Falha ao ler correlationId do envelope: ${correlationReadError?.message || String(correlationReadError)}`);
                correlationId = envelope?.correlationId || envelope?.causality?.correlation_id || null;
            }

            if (actionCode === ActionCode.DRIVER_TASK_COMPLETED) {
                this._handleTaskCompleted(/** @type {DriverTaskCompletedPayload} */ (payload), correlationId).catch(err => {
                    logger.log('ERROR', `[TaskExecutionOrchestrator] Handler DRIVER_TASK_COMPLETED falhou: ${err?.message || String(err)}`, correlationId);
                });
                return;
            }

            if (actionCode === ActionCode.DRIVER_TASK_FAILED) {
                this._handleTaskFailed(/** @type {DriverTaskFailedPayload} */ (payload), correlationId).catch(err => {
                    logger.log('ERROR', `[TaskExecutionOrchestrator] Handler DRIVER_TASK_FAILED falhou: ${err?.message || String(err)}`, correlationId);
                });
                return;
            }

            if (actionCode === ActionCode.DRIVER_TASK_QUEUED) {
                this._handleTaskQueued(payload, correlationId);
                return;
            }
        });

        // Nem todo NERV retorna unsubscribe; trata ambos os casos.
        this.unsubscribeNerv = typeof maybeUnsub === 'function' ? maybeUnsub : null;

        logger.log('DEBUG', '[TaskExecutionOrchestrator] Listeners configurados');
    }

    /**
     * Handler: Task completada com sucesso.
     * @param {DriverTaskCompletedPayload} payload
     * @param {string|null} correlationId
     */
    async _handleTaskCompleted(payload, correlationId) {
        const safePayload = payload && typeof payload === 'object' ? payload : {};
        const taskId = safePayload.taskId;
        const result = safePayload.result;

        if (!taskId) {
            return;
        }

        const cached = this.activeExecutions.get(taskId);
        if (!cached) {
            // Task não estava sendo orquestrada (pode ser V1.x ou external)
            return;
        }

        // Ignora eventos atrasados/stale/malformados: correlationId é obrigatório quando há dispatch com correlationId
        if (cached.correlationId && cached.correlationId !== correlationId) {
            logger.log(
                'WARN',
                `[TaskExecutionOrchestrator] Evento COMPLETED inválido/stale ignorado para ${taskId} (corr=${correlationId || 'missing'}, expected=${cached.correlationId})`,
                correlationId
            );
            return;
        }

        const idempotency = this.processedExecutionEvents.get(taskId) || {
            correlationId: cached.correlationId || null,
            processed: new Set()
        };

        if (idempotency.correlationId && idempotency.correlationId !== correlationId) {
            logger.log(
                'WARN',
                `[TaskExecutionOrchestrator] Janela de idempotência bloqueou COMPLETED para ${taskId} (corr=${correlationId || 'missing'}, expected=${idempotency.correlationId})`,
                correlationId
            );
            return;
        }

        if (idempotency.processed.has('COMPLETED') || idempotency.processed.has('FAILED')) {
            logger.log('WARN', `[TaskExecutionOrchestrator] Evento duplicado ignorado para ${taskId}`, correlationId);
            return;
        }

        idempotency.processed.add('COMPLETED');
        this.processedExecutionEvents.set(taskId, idempotency);

        const task = cached.task;
        const executionDuration = Date.now() - cached.startedAt;

        logger.log('INFO', `[TaskExecutionOrchestrator] Task completada: ${taskId} (${executionDuration}ms)`, correlationId);

        let decision;
        try {
            // Hook: afterExecution (orchestrator decide próxima ação)
            decision = await this.nervBridge.afterTaskExecution(task, result);
        } catch (err) {
            const msg = err?.message || String(err);
            logger.log('ERROR', `[TaskExecutionOrchestrator] afterTaskExecution falhou: ${taskId} - ${msg}`, correlationId);

            // Trata como falha permanente do pipeline do kernel (não do driver)
            if (typeof this.onTaskPermanentFailure === 'function') {
                await this.onTaskPermanentFailure({
                    taskId,
                    correlationId,
                    reason: `afterTaskExecution failed: ${msg}`,
                    payload: { taskId, error: msg, reason: 'AFTER_EXECUTION_FAILED', retryable: false }
                });
            }

            this.activeExecutions.delete(taskId);
            this.processedExecutionEvents.delete(taskId);
            return;
        }

        logger.log('DEBUG', `[TaskExecutionOrchestrator] Decisão: ${decision?.action} para task ${taskId}`, correlationId);

        try {
            await this.nervBridge.processOrchestrationDecision(decision, correlationId);
        } catch (err) {
            const msg = err?.message || String(err);
            logger.log('ERROR', `[TaskExecutionOrchestrator] processOrchestrationDecision falhou: ${taskId} - ${msg}`, correlationId);

            // Fail-safe: se não consegue processar a decisão, pede retry (quando possível)
            if (typeof this.onTaskRetryRequested === 'function') {
                await this.onTaskRetryRequested({
                    taskId,
                    correlationId,
                    delayMs: 250,
                    reason: `Decision processing failed: ${msg}`,
                    nextAction: 'RETRY_LATER',
                    payload: { taskId, error: msg, reason: 'DECISION_PROCESSING_FAILED', retryable: true, suggestedDelayMs: 250 }
                });
            } else if (typeof this.onTaskPermanentFailure === 'function') {
                await this.onTaskPermanentFailure({
                    taskId,
                    correlationId,
                    reason: `Decision processing failed: ${msg}`,
                    payload: { taskId, error: msg, reason: 'DECISION_PROCESSING_FAILED', retryable: false }
                });
            }

            this.activeExecutions.delete(taskId);
            this.processedExecutionEvents.delete(taskId);
            return;
        }

        // Remove do cache se DONE
        if (decision?.action === 'DONE') {
            if (typeof this.onTaskCompleted === 'function') {
                await this.onTaskCompleted({ taskId, correlationId, decision });
            }
            this.activeExecutions.delete(taskId);
            this.processedExecutionEvents.delete(taskId);
        }
    }

    /**
     * Handler: Task falhou.
     * @param {DriverTaskFailedPayload} payload
     * @param {string|null} correlationId
     */
    async _handleTaskFailed(payload, correlationId) {
        const safePayload = payload && typeof payload === 'object' ? payload : {};
        const taskId = safePayload.taskId;

        if (!taskId) {
            return;
        }

        const cached = this.activeExecutions.get(taskId);
        if (!cached) {
            return;
        }

        // Ignora eventos atrasados/stale/malformados: correlationId é obrigatório quando há dispatch com correlationId
        if (cached.correlationId && cached.correlationId !== correlationId) {
            logger.log(
                'WARN',
                `[TaskExecutionOrchestrator] Evento FAILED inválido/stale ignorado para ${taskId} (corr=${correlationId || 'missing'}, expected=${cached.correlationId})`,
                correlationId
            );
            return;
        }

        const idempotency = this.processedExecutionEvents.get(taskId) || {
            correlationId: cached.correlationId || null,
            processed: new Set()
        };

        if (idempotency.correlationId && idempotency.correlationId !== correlationId) {
            logger.log(
                'WARN',
                `[TaskExecutionOrchestrator] Janela de idempotência bloqueou FAILED para ${taskId} (corr=${correlationId || 'missing'}, expected=${idempotency.correlationId})`,
                correlationId
            );
            return;
        }

        if (idempotency.processed.has('FAILED') || idempotency.processed.has('COMPLETED')) {
            logger.log('WARN', `[TaskExecutionOrchestrator] Evento duplicado ignorado para ${taskId}`, correlationId);
            return;
        }

        idempotency.processed.add('FAILED');
        this.processedExecutionEvents.set(taskId, idempotency);

        const errorText = safePayload.error || safePayload.reason || 'Unknown task failure';
        const reason = safePayload.reason || 'UNKNOWN';

        logger.log('ERROR', `[TaskExecutionOrchestrator] Task falhou: ${taskId} - ${errorText}`, correlationId);

        const retryable = safePayload.retryable === true;
        const suggestedDelayMs = Number(safePayload.suggestedDelayMs || safePayload.retryDelayMs || 0) || 0;
        const nextAction = safePayload.next_action || (retryable ? 'RETRY_LATER' : 'ABORT');

        if (retryable && typeof this.onTaskRetryRequested === 'function') {
            await this.onTaskRetryRequested({
                taskId,
                correlationId,
                delayMs: suggestedDelayMs,
                reason: reason || errorText,
                nextAction,
                payload: safePayload
            });
        } else if (typeof this.onTaskPermanentFailure === 'function') {
            await this.onTaskPermanentFailure({
                taskId,
                correlationId,
                reason: reason || errorText,
                payload: safePayload
            });
        }

        // Limpa estado local (a reexecução/retry cria nova janela via executeTask())
        this.activeExecutions.delete(taskId);
        this.processedExecutionEvents.delete(taskId);

        // Emite evento de falha padronizado para consumidores de domínio TASK
        // (mantém superset de campos para observabilidade, sem quebrar consumidores legados)
        try {
            this.nervBridge.emitEvent({
                target: null, // broadcast
                correlationId,
                payload: {
                    actionCode: ActionCode.TASK_FAILED,
                    taskId,
                    error: errorText,
                    reason,
                    retryable,
                    next_action: nextAction,
                    suggestedDelayMs,
                    errorType: safePayload.errorType || safePayload.error_type || null,
                    operation: safePayload.operation || null,
                    isTimeout: safePayload.isTimeout ?? null,
                    errorClassification: safePayload.errorClassification || null,
                    retriesAttempted: safePayload.retriesAttempted ?? null
                }
            });
        } catch (emitError) {
            logger.log(
                'ERROR',
                `[TaskExecutionOrchestrator] emitEvent TASK_FAILED falhou para ${taskId}: ${emitError?.message || String(emitError)}`,
                correlationId
            );
        }
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
            try {
                this.unsubscribeNerv();
            } catch (unsubscribeError) {
                logger.log('WARN', `[TaskExecutionOrchestrator] Falha ao remover listener anterior: ${unsubscribeError?.message || String(unsubscribeError)}`);
            }
            this.unsubscribeNerv = null;
        }

        logger.log('INFO', '[TaskExecutionOrchestrator] Cleanup completo');
    }
}

export { TaskExecutionOrchestrator };
