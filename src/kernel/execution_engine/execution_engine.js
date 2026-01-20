/* ==========================================================================
   src/kernel/execution_engine/execution_engine.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: execution_engine/
   Arquivo: execution_engine.js
   
   Papel:
   - Avaliar o estado completo do Kernel em cada ciclo
   - Produzir PROPOSTAS de decisão (não as aplica)
   - Consultar PolicyEngine para avaliação normativa
   - Interpretar observações semanticamente
   
   IMPORTANTE:
   - NÃO aplica decisões (isso é papel do KernelLoop)
   - NÃO controla tempo (é chamado pelo KernelLoop)
   - NÃO comunica via IPC (usa TaskRuntime/ObservationStore)
   - NÃO muta estado diretamente
   
   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Tipos de Proposta de Decisão
=========================== */

const DecisionKind = Object.freeze({
  // Controle de tarefas
  PROPOSE_ACTIVATE_TASK: 'PROPOSE_ACTIVATE_TASK',
  PROPOSE_SUSPEND_TASK: 'PROPOSE_SUSPEND_TASK',
  PROPOSE_TERMINATE_TASK: 'PROPOSE_TERMINATE_TASK',
  
  // Emissão de comandos
  PROPOSE_EMIT_COMMAND: 'PROPOSE_EMIT_COMMAND',
  PROPOSE_EMIT_EVENT: 'PROPOSE_EMIT_EVENT',
  
  // Gestão de observações
  PROPOSE_RECONCILE_OBSERVATIONS: 'PROPOSE_RECONCILE_OBSERVATIONS'
});

/* ===========================
   Fábrica do ExecutionEngine
=========================== */

class ExecutionEngine {
  /**
   * @param {Object} params
   * @param {Object} params.taskRuntime
   * Gerenciador de vida das tarefas.
   * 
   * @param {Object} params.observationStore
   * Registro de EVENTs recebidos.
   * 
   * @param {Object} params.policyEngine
   * Motor normativo consultivo.
   * 
   * @param {Object} params.telemetry
   * Canal de telemetria.
   */
  constructor({
    taskRuntime,
    observationStore,
    policyEngine,
    telemetry
  }) {
    if (!taskRuntime) {
      throw new Error('ExecutionEngine requer taskRuntime');
    }

    if (!observationStore) {
      throw new Error('ExecutionEngine requer observationStore');
    }

    if (!policyEngine) {
      throw new Error('ExecutionEngine requer policyEngine');
    }

    if (!telemetry || typeof telemetry.emit !== 'function') {
      throw new Error('ExecutionEngine requer telemetria válida');
    }

    this.taskRuntime = taskRuntime;
    this.observationStore = observationStore;
    this.policyEngine = policyEngine;
    this.telemetry = telemetry;
  }

  /* ===========================
     AVALIAÇÃO SEMÂNTICA (PONTO ÚNICO)
  =========================== */

  /**
   * Avalia o estado completo do Kernel e produz propostas de decisão.
   * 
   * Chamado exclusivamente pelo KernelLoop a cada ciclo.
   * 
   * @param {Object} context
   * @param {number} context.tickId
   * Identificador do ciclo lógico.
   * 
   * @param {number} context.at
   * Timestamp do ciclo.
   * 
   * @returns {Array<Object>}
   * Lista de propostas de decisão.
   */
  evaluate({ tickId, at }) {
    this.telemetry.info('execution_engine_evaluation_start', {
      tickId,
      at
    });

    const proposals = [];

    // Obtém todas as tarefas existentes
    const tasks = this.taskRuntime.listTasks();

    // Avalia cada tarefa individualmente
    for (const task of tasks) {
      const taskProposals = this._evaluateTask(task, { tickId, at });
      
      if (Array.isArray(taskProposals)) {
        proposals.push(...taskProposals);
      }
    }

    this.telemetry.info('execution_engine_evaluation_complete', {
      tickId,
      proposalsCount: proposals.length,
      at: Date.now()
    });

    return proposals;
  }

  /* ===========================
     AVALIAÇÃO DE TAREFA INDIVIDUAL
  =========================== */

  /**
   * Avalia uma tarefa específica.
   * 
   * @param {Object} task
   * Snapshot imutável da tarefa.
   * 
   * @param {Object} context
   * Contexto do ciclo.
   * 
   * @returns {Array<Object>}
   * Propostas geradas para esta tarefa.
   */
  _evaluateTask(task, { tickId, at }) {
    const proposals = [];

    // 1. Recupera observações correlacionadas
    const observations = task.metadata?.correlationId
      ? this.observationStore.getByCorrelation(task.metadata.correlationId)
      : [];

    // 2. Avaliação normativa via PolicyEngine
    const policyAssessment = this.policyEngine.assess({
      task,
      observations,
      at
    });

    // 3. Interpretação semântica
    const semanticDecisions = this._interpretObservations({
      task,
      observations,
      at
    });

    // 4. Combinação de avaliação normativa + semântica
    const proposal = this._synthesizeProposal({
      task,
      observations,
      policyAssessment,
      semanticDecisions,
      at
    });

    if (proposal) {
      this.telemetry.info('execution_engine_proposal_created', {
        taskId: task.taskId,
        kind: proposal.kind,
        tickId,
        at: Date.now()
      });

      proposals.push(proposal);
    }

    return proposals;
  }

  /* ===========================
     INTERPRETAÇÃO SEMÂNTICA DE OBSERVAÇÕES
  =========================== */

  /**
   * Interpreta semanticamente as observações de uma tarefa.
   * 
   * @param {Object} params
   * @param {Object} params.task
   * @param {Array} params.observations
   * @param {number} params.at
   * 
   * @returns {Object}
   * Resultado da interpretação semântica.
   */
  _interpretObservations({ task, observations, at }) {
    const result = {
      hasCompletionSignal: false,
      hasErrorSignal: false,
      hasProgressSignal: false,
      lastObservationAt: null
    };

    if (observations.length === 0) {
      return result;
    }

    // Ordena observações por timestamp de ingestão
    const sorted = [...observations].sort((a, b) => 
      a.ingestedAt - b.ingestedAt
    );

    result.lastObservationAt = sorted[sorted.length - 1].ingestedAt;

    // Interpreta payloads (exemplo simplificado)
    for (const obs of sorted) {
      const payload = obs.payload;

      // Sinal de conclusão
      if (payload?.status === 'completed' || payload?.done === true) {
        result.hasCompletionSignal = true;
      }

      // Sinal de erro
      if (payload?.status === 'error' || payload?.error) {
        result.hasErrorSignal = true;
      }

      // Sinal de progresso
      if (payload?.progress !== undefined) {
        result.hasProgressSignal = true;
      }
    }

    this.telemetry.info('execution_engine_observations_interpreted', {
      taskId: task.taskId,
      observationsCount: observations.length,
      hasCompletionSignal: result.hasCompletionSignal,
      hasErrorSignal: result.hasErrorSignal,
      at
    });

    return result;
  }

  /* ===========================
     SÍNTESE DE PROPOSTA
  =========================== */

  /**
   * Sintetiza uma proposta de decisão a partir de:
   * - Avaliação normativa (PolicyEngine)
   * - Interpretação semântica (observações)
   * - Estado atual da tarefa
   * 
   * @param {Object} params
   * @returns {Object|null}
   * Proposta de decisão ou null se nenhuma ação necessária.
   */
  _synthesizeProposal({
    task,
    observations,
    policyAssessment,
    semanticDecisions,
    at
  }) {
    // Regra 1: Suspender tarefa se avaliação normativa crítica
    if (
      policyAssessment?.level === 'CRITICAL' &&
      task.state === 'ACTIVE'
    ) {
      return {
        kind: DecisionKind.PROPOSE_SUSPEND_TASK,
        taskId: task.taskId,
        reason: 'Avaliação normativa crítica',
        policyLevel: policyAssessment.level,
        alerts: policyAssessment.alerts,
        at
      };
    }

    // Regra 2: Terminar tarefa se sinal de conclusão
    if (
      semanticDecisions.hasCompletionSignal &&
      task.state === 'ACTIVE'
    ) {
      return {
        kind: DecisionKind.PROPOSE_TERMINATE_TASK,
        taskId: task.taskId,
        reason: 'Sinal de conclusão recebido',
        at
      };
    }

    // Regra 3: Suspender tarefa se sinal de erro
    if (
      semanticDecisions.hasErrorSignal &&
      task.state === 'ACTIVE'
    ) {
      return {
        kind: DecisionKind.PROPOSE_SUSPEND_TASK,
        taskId: task.taskId,
        reason: 'Sinal de erro detectado',
        at
      };
    }

    // Regra 4: Ativar tarefa criada sem observações após tempo mínimo
    if (
      task.state === 'CREATED' &&
      at - task.createdAt > 100 // 100ms após criação
    ) {
      return {
        kind: DecisionKind.PROPOSE_ACTIVATE_TASK,
        taskId: task.taskId,
        reason: 'Tempo mínimo de inicialização atingido',
        at
      };
    }

    // Sem proposta
    return null;
  }
}

module.exports = {
  ExecutionEngine,
  DecisionKind
};