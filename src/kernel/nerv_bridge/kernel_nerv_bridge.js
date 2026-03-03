// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActorRole, MessageType, ActionCode } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { getCorrelationId, getMessageType, getMsgId, getPayload } from '#shared/nerv/envelope_reader';
import { buildWorkflowNextStepTask as defaultWorkflowBuilder } from '#agent/workflow_next_step_builder';
import { recordEvent } from '#infra/db/events_repo';
import { insertTask, TASK_STAGES } from '#infra/db/task_repo';

/* ===========================
   Utilitários internos
=========================== */

/**
 * Valida envelope recebido do NERV.
 * @param {*} envelope
 */
function isValidEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') return false;
    const kind = getMessageType(envelope);
    const correlationId = getCorrelationId(envelope);
    const payload = getPayload(envelope);
    return Boolean(kind && correlationId && payload && typeof payload === 'object');
}

/**
 * Extrai dados estruturais do envelope de forma segura.
 * @param {*} envelope
 */
function extractEnvelopeData(envelope) {
    return {
        msgId: getMsgId(envelope),
        correlationId: getCorrelationId(envelope),
        source: envelope?.identity?.actor || envelope?.header?.source || 'unknown',
        timestamp: envelope?.protocol?.timestamp ?? envelope?.header?.timestamp ?? Date.now(),
        kind: getMessageType(envelope),
        payload: getPayload(envelope),
    };
}

/* ===========================
   Fábrica da Ponte KERNEL↔NERV
=========================== */

/**
 * Cria a ponte de integração entre Kernel e NERV.
 *
 * @param {object} deps
 * @param {object} deps.nerv
 * Instância do NERV já configurada.
 *
 * @param {object} deps.taskRuntime
 * Instância do TaskRuntime.
 *
 * @param {object} deps.observationStore
 * Instância do ObservationStore.
 *
 * @param {object} deps.telemetry
 * Canal de telemetria do Kernel.
 *
 * @param {object} [deps.orchestrator]
 * Instância do OrchestratorEngine (V2.0 - opcional para backward compatibility).
 */
class KernelNERVBridge {
    constructor({ nerv, taskRuntime, observationStore, telemetry, orchestrator = null, workflowBuilder = null }) {
        if (!nerv) {
            throw new Error('KernelNERVBridge requer instância do NERV');
        }

        if (!taskRuntime) {
            throw new Error('KernelNERVBridge requer TaskRuntime');
        }

        if (!observationStore) {
            throw new Error('KernelNERVBridge requer ObservationStore');
        }

        if (!telemetry || typeof telemetry.emit !== 'function') {
            throw new Error('KernelNERVBridge requer telemetria válida');
        }

        this.nerv = nerv;
        this.taskRuntime = taskRuntime;
        this.observationStore = observationStore;
        this.telemetry = telemetry;
        this.orchestrator = orchestrator; // V2.0: Motor de orquestração
        this.workflowBuilder = workflowBuilder ?? defaultWorkflowBuilder; // V2.0: Injectable, decoupled from #agent/

        this.started = false;
        this.unsubscribe = null;

        // V2.0: Cache para tracking de execuções orquestradas
        // task_id -> { task, executionResult, iteration }
        this.orchestrationCache = new Map();
    }

    /* ===========================
     LIFECYCLE
  =========================== */

    /**
     * Inicia a ponte, registrando handlers no NERV.
     */
    start() {
        if (this.started) {
            this.telemetry.warning('nerv_bridge_already_started');
            return;
        }

        this.telemetry.info('nerv_bridge_starting', {
            at: Date.now(),
        });

        // Registra handler de recepção de envelopes
        this.unsubscribe = this.nerv.onReceive(envelope => {
            this._handleInboundEnvelope(envelope);
        });

        this.started = true;

        this.telemetry.info('nerv_bridge_started', {
            at: Date.now(),
        });
    }

    /**
     * Para a ponte, desregistrando handlers.
     */
    stop() {
        if (!this.started) {
            this.telemetry.warning('nerv_bridge_already_stopped');
            return;
        }

        this.telemetry.info('nerv_bridge_stopping', {
            at: Date.now(),
        });

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        this.started = false;

        this.telemetry.info('nerv_bridge_stopped', {
            at: Date.now(),
        });
    }

    /* ===========================
     RECEPÇÃO DE ENVELOPES (INBOUND)
  =========================== */

    /**
     * Processa envelope recebido do NERV.
     *
     * IMPORTANTE:
     * - Apenas EVENTs são processados (fatos do mundo)
     * - ACKs são ignorados (confirmações físicas)
     * - COMMANDs recebidos são anomalia (Kernel não recebe comandos)
     */
    _handleInboundEnvelope(envelope) {
        if (!isValidEnvelope(envelope)) {
            this.telemetry.warning('nerv_bridge_invalid_envelope', {
                at: Date.now(),
            });
            return;
        }

        const data = extractEnvelopeData(envelope);

        this.telemetry.info('nerv_bridge_envelope_received', {
            kind: data.kind,
            msgId: data.msgId,
            correlationId: data.correlationId,
            at: Date.now(),
        });

        // Apenas EVENTs são fatos do mundo
        if (data.kind === MessageType.EVENT) {
            this._processEvent(envelope, data);
            return;
        }

        // ACKs são confirmações físicas (ignoradas semanticamente)
        if (data.kind === MessageType.ACK) {
            this.telemetry.info('nerv_bridge_ack_received', {
                msgId: data.msgId,
                at: Date.now(),
            });
            return;
        }

        // COMMANDs recebidos são anomalia
        if (data.kind === MessageType.COMMAND) {
            this.telemetry.warning('nerv_bridge_unexpected_command', {
                msgId: data.msgId,
                source: data.source,
                at: Date.now(),
            });
            return;
        }

        // Tipo desconhecido
        this.telemetry.warning('nerv_bridge_unknown_envelope_kind', {
            kind: data.kind,
            at: Date.now(),
        });
    }

    /**
     * Processa EVENT recebido, encaminhando ao ObservationStore.
     */
    _processEvent(envelope, data) {
        try {
            // Delega ingestão ao ObservationStore
            this.observationStore.ingestEvent(envelope);

            this.telemetry.info('nerv_bridge_event_ingested', {
                msgId: data.msgId,
                correlationId: data.correlationId,
                at: Date.now(),
            });
        } catch (error) {
            this.telemetry.critical('nerv_bridge_event_ingestion_failed', {
                msgId: data.msgId,
                error: error.message,
                at: Date.now(),
            });
        }
    }

    /* ===========================
     EMISSÃO DE ENVELOPES (OUTBOUND)
  =========================== */

    /**
     * Emite um COMMAND via NERV.
     *
     * @param {object} params
     * @param {string} params.target
     * Destinatário do comando (ex.: 'driver', 'server').
     *
     * @param {string} params.correlationId
     * ID de correlação (vincula a uma tarefa).
     *
     * @param {object} params.payload
     * Payload opaco do comando.
     */
    /**
     * ✅ P1-4: Agora async para aguardar emissão e garantir telemetria correta.
     */
    async emitCommand({ target, correlationId, payload }) {
        if (!this.started) {
            throw new Error('KernelNERVBridge não iniciada');
        }
        // Extract actionCode from payload if present
        const actionCode = (payload && payload.actionCode) || ActionCode.KERNEL_INTERNAL_ERROR;
        const targetRole = target ? ActorRole[target.toUpperCase()] || null : null;

        try {
            const envelope = await HighLevelNERV.sendCommand(
                this.nerv,
                ActorRole.KERNEL,
                actionCode,
                payload,
                correlationId,
                targetRole
            ); // ✅ P1-4: Added await
            const msgId = envelope && envelope.causality && envelope.causality.msg_id;

            this.telemetry.info('nerv_bridge_command_emitted', {
                msgId,
                correlationId,
                target: target ?? 'unknown',
                at: Date.now(),
            });
        } catch (error) {
            this.telemetry.critical('nerv_bridge_command_emission_failed', {
                error: error.message,
                correlationId,
                at: Date.now(),
            });

            throw error;
        }
    }

    /**
     * Emite um EVENT via NERV.
     *
     * @param {object} params
     * @param {string} [params.target]
     * Destinatário opcional (broadcast se ausente).
     *
     * @param {string} params.correlationId
     * ID de correlação.
     *
     * @param {object} params.payload
     * Payload opaco do evento.
     */
    /**
     * ✅ P1-4: Agora async para aguardar emissão e garantir telemetria correta.
     */
    async emitEvent({ target = null, correlationId, payload }) {
        if (!this.started) {
            throw new Error('KernelNERVBridge não iniciada');
        }

        // Extrair actionCode do payload (ou usar genérico)
        const actionCode = payload.actionCode || ActionCode.KERNEL_TELEMETRY;
        const targetRole = target ? ActorRole[target.toUpperCase()] || null : null;

        try {
            const envelope = await HighLevelNERV.sendEvent(
                this.nerv,
                ActorRole.KERNEL,
                actionCode,
                payload,
                correlationId,
                targetRole
            ); // ✅ P1-4: Added await
            const msgId = envelope && envelope.causality && envelope.causality.msg_id;

            this.telemetry.info('nerv_bridge_event_emitted', {
                msgId,
                correlationId,
                target: target ?? 'broadcast',
                at: Date.now(),
            });
        } catch (error) {
            this.telemetry.critical('nerv_bridge_event_emission_failed', {
                error: error.message,
                correlationId,
                at: Date.now(),
            });

            throw error;
        }
    }

    /* ===========================
     ORCHESTRATION HOOKS (V2.0)
  =========================== */

    /**
     * Hook: Intercepta task ANTES da execução.
     * Permite orchestrator preparar task (ITERATIVE, MULTI_STEP).
     *
     * @param {object} task - Task V5
     * @returns {Promise<object>} - Task modificada (se orquestrada)
     */
    async beforeTaskExecution(task) {
        if (!this.orchestrator) {
            return task; // V1.x fallback: sem orchestrator
        }

        // Verifica se task precisa de orquestração
        if (!this.orchestrator.shouldOrchestrate(task)) {
            this.telemetry.info('nerv_bridge_task_no_orchestration', {
                taskId: task.meta?.id,
                strategy: task.spec?.execution?.strategy || 'SINGLE_SHOT',
                at: Date.now(),
            });
            return task;
        }

        this.telemetry.info('nerv_bridge_task_orchestration_start', {
            taskId: task.meta?.id,
            strategy: task.spec?.execution?.strategy,
            at: Date.now(),
        });

        // Prepara task (inicializa state de workflow/iteração)
        // ✅ P0-2.4: beforeExecution agora é async (workflow locking)
        const preparedTask = await this.orchestrator.beforeExecution(task);

        // Cacheia task para afterExecution
        this.orchestrationCache.set(task.meta.id, {
            task: preparedTask,
            startedAt: Date.now(),
        });

        return preparedTask;
    }

    /**
     * Hook: Intercepta task APÓS a execução.
     * Permite orchestrator decidir próxima ação (DONE/RETRY/NEXT_STEP).
     *
     * @param {object} task - Task V5
     * @param {object} executionResult - Resultado da execução do driver
     * @returns {Promise<object>} - Decisão { action, task, feedback, nextStep }
     */
    async afterTaskExecution(task, executionResult) {
        if (!this.orchestrator) {
            // V1.x fallback: sempre DONE
            return { action: 'DONE', task, feedback: null };
        }

        // Recupera task cacheada (pode ter sido modificada por beforeExecution)
        const cached = this.orchestrationCache.get(task.meta.id);
        const taskToEvaluate = cached?.task || task;

        this.telemetry.info('nerv_bridge_task_orchestration_evaluate', {
            taskId: task.meta.id,
            executionDuration: cached ? Date.now() - cached.startedAt : 0,
            at: Date.now(),
        });

        // Orchestrator decide próxima ação
        const decision = await this.orchestrator.afterExecution(taskToEvaluate, executionResult);

        this.telemetry.info('nerv_bridge_task_orchestration_decision', {
            taskId: task.meta.id,
            action: decision.action,
            hasFeedback: !!decision.feedback,
            hasNextStep: !!decision.nextStep,
            at: Date.now(),
        });

        // Limpa cache se decisão for DONE
        if (decision.action === 'DONE') {
            this.orchestrationCache.delete(task.meta.id);
        }

        return decision;
    }

    /**
     * Processa decisão do orchestrator.
     * Aplica ação: RETRY → reenviar task, NEXT_STEP → criar nova task, DONE → finalizar.
     *
     * @param {object} decision - Decisão do orchestrator
     * @param {string} correlationId - ID de correlação NERV
     * @returns {Promise<void>}
     */
    async processOrchestrationDecision(decision, correlationId) {
        const { action, task, feedback, nextStep } = decision;

        switch (action) {
            case 'RETRY':
                // Injeta feedback no prompt e reenvia para execução
                await this._handleRetryAction(task, feedback, correlationId);
                break;

            case 'NEXT_STEP':
                // Cria nova task para próximo step do workflow
                await this._handleNextStepAction(task, nextStep, feedback, correlationId);
                break;

            case 'DONE':
                // Finaliza task (já processado em afterTaskExecution)
                this.telemetry.info('nerv_bridge_orchestration_done', {
                    taskId: task.meta.id,
                    correlationId,
                    at: Date.now(),
                });
                break;

            default:
                this.telemetry.warning('nerv_bridge_orchestration_unknown_action', {
                    action,
                    taskId: task.meta.id,
                    at: Date.now(),
                });
        }
    }

    /**
     * Handler interno: RETRY action
     */
    async _handleRetryAction(task, feedback, correlationId) {
        this.telemetry.info('nerv_bridge_orchestration_retry', {
            taskId: task.meta.id,
            iteration: task.state?.iteration_state?.current_iteration,
            feedbackLength: feedback?.length || 0,
            correlationId,
            at: Date.now(),
        });

        // Injeta feedback no prompt original (imutável: payload pode estar congelado)
        const prevSpec = task && typeof task.spec === 'object' && task.spec !== null ? task.spec : null;
        const prevPayload =
            prevSpec && typeof prevSpec.payload === 'object' && prevSpec.payload !== null ? prevSpec.payload : null;
        const originalPrompt = prevPayload?.user_message || prevPayload?.prompt || '';
        const nextPayload = prevPayload
            ? { ...prevPayload, user_message: originalPrompt + '\n\n' + feedback }
            : prevPayload;
        const nextSpec = prevSpec ? { ...prevSpec, payload: nextPayload } : prevSpec;
        const retryTask = { ...task, spec: nextSpec };

        // Emite comando para re-executar task com feedback
        await this.emitCommand({
            target: 'driver',
            correlationId,
            payload: {
                actionCode: ActionCode.DRIVER_EXECUTE_TASK,
                task: retryTask,
            },
        });
    }

    /**
     * Handler interno: NEXT_STEP action
     */
    async _handleNextStepAction(task, nextStep, feedback, correlationId) {
        const now = Date.now();
        const taskId = task?.meta?.id ? String(task.meta.id) : null;
        if (!taskId) {
            this.telemetry.warning('nerv_bridge_orchestration_next_step_missing_task_id', {
                correlationId,
                at: now,
            });
            return;
        }

        const nextAction = nextStep?.action ? String(nextStep.action) : 'execute_prompt';
        if (nextAction !== 'execute_prompt') {
            this.telemetry.warning('nerv_bridge_orchestration_next_step_unsupported_action', {
                taskId,
                action: nextAction,
                correlationId,
                at: now,
            });
            return;
        }

        const workflowState =
            task?.state?.workflow_state && typeof task.state.workflow_state === 'object'
                ? task.state.workflow_state
                : {};
        const completedStepIds = Array.isArray(workflowState.completed_steps) ? workflowState.completed_steps : [];
        const accumulatedContext =
            workflowState.accumulated_context && typeof workflowState.accumulated_context === 'object'
                ? workflowState.accumulated_context
                : {};
        const inferredIndex = Number(
            nextStep?.step_index ??
                nextStep?.stepIndex ??
                nextStep?.index ??
                workflowState.current_step_index ??
                completedStepIds.length
        );
        const nextStepIndex = Number.isFinite(inferredIndex)
            ? Math.max(0, inferredIndex)
            : Math.max(0, completedStepIds.length);
        const attemptId = correlationId ? String(correlationId) : null;

        this.telemetry.info('nerv_bridge_orchestration_next_step', {
            taskId,
            nextStepId: nextStep?.id,
            workflowId: task?.meta?.workflow_id,
            correlationId,
            at: now,
        });

        const { childTask, childId, nextStepId, workflowId } = this.workflowBuilder({
            parentTask: task,
            parentTaskId: taskId,
            attemptId,
            nextStep,
            nextStepIndex,
            workflowConfig: task?.spec?.execution?.workflow_config || null,
            completedStepIds: completedStepIds.map(stepId => String(stepId)),
            accumulatedContext,
            nowMs: now,
            source: 'self_generated',
        });

        insertTask(childTask, {
            stage: TASK_STAGES.READY,
            status: 'PENDING',
            actor: 'system',
            ifNotExists: true,
        });

        recordEvent({
            entityType: 'task',
            entityId: taskId,
            tsMs: now,
            actorType: 'system',
            eventType: 'TASK_ORCHESTRATION_NEXT_STEP_CREATED',
            payload: {
                from_task_id: taskId,
                from_attempt_id: attemptId,
                to_task_id: childId,
                workflow_id: workflowId,
                step_id: nextStepId,
                step_index: nextStepIndex,
            },
            dedupKey: `task:${taskId}:next_step:${attemptId || 'none'}:${nextStepId}`,
        });

        await this.emitEvent({
            target: 'server',
            correlationId: task?.meta?.workflow_id || correlationId,
            payload: {
                actionCode: ActionCode.WORKFLOW_STEP_STARTED,
                workflow_id: task?.meta?.workflow_id || workflowId,
                step_id: nextStepId,
                previous_task_id: taskId,
                child_task_id: childId,
            },
        });

        this.telemetry.info('nerv_bridge_next_step_task_created', {
            taskId,
            childTaskId: childId,
            nextStepId,
            workflowId,
            correlationId,
            feedbackLength: typeof feedback === 'string' ? feedback.length : 0,
            at: now,
        });
    }

    /* ===========================
     OBSERVABILIDADE
  =========================== */

    /**
     * Retorna status técnico da ponte.
     */
    getStatus() {
        return Object.freeze({
            started: this.started,
            nerv: this.nerv ? 'connected' : 'disconnected',
            orchestrator: this.orchestrator ? 'enabled' : 'disabled',
            orchestratedTasks: this.orchestrationCache.size,
        });
    }
}

export { KernelNERVBridge };
