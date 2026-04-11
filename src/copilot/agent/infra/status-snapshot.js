// @ts-check
/**
 * src/copilot/agent/infra/status-snapshot.js
 *
 * Função pura para construir o snapshot de status do AlwaysAliveAgent.
 *
 * Recebe um objeto `params` com todos os dados necessários, sem acesso a estado mutable, o que facilita o teste
 * unitário e desacopla a lógica de construção do snapshot do agente.
 *
 * @module copilot/agent/infra/status-snapshot
 * @see EventBus
 */

import { STARVATION_THRESHOLD_MS } from '../config.js';

/**
 * @typedef {import('../types.js').AgentStatusSnapshot} AgentStatusSnapshot
 *
 * @typedef {import('../types.js').AgentStatus} AgentStatus
 *
 * @typedef {import('../types.js').AgentTask} AgentTask
 *
 * @typedef {import('../types.js').PendingQuestion} PendingQuestion
 */

/**
 * Parâmetros necessários para construir um snapshot de status.
 *
 * @typedef {Object} SnapshotParams
 * @property {AgentStatus} status - Status atual do agente
 * @property {string | null} sessionId - ID da sessão ativa
 * @property {string} model - Modelo ativo
 * @property {'low' | 'medium' | 'high' | 'xhigh' | undefined} reasoningEffort - Nível de raciocínio
 * @property {number} queueSize - Tamanho da fila de tarefas
 * @property {AgentTask | undefined} queueOldest - Tarefa mais antiga na fila (undefined se vazia)
 * @property {PendingQuestion | null} pendingQuestion - Pergunta pendente do modelo
 * @property {boolean} isResumed - true se a sessão foi retomada
 * @property {number} resumeCount - Número de retomadas
 * @property {number} sendCount - Total de mensagens enviadas
 * @property {number | null} startedAt - Epoch ms do início da sessão
 * @property {{ tokens: number; tokenLimit: number; utilization: number } | null} contextWindow - Uso de contexto
 * @property {string | null} lastCheckpointPath - Último caminho de checkpoint
 * @property {'approve_all' | 'audit_only' | 'selective'} permissionMode - Modo de permissão ativo
 */

/** Tempo máximo (ms) antes de considerar uma tarefa em starvation. */
// G1-DX-05: threshold configurável via env (default: 60s)

/**
 * Constrói o snapshot de status do agente a partir de parâmetros imutáveis.
 *
 * @example
 *     const snap = buildStatusSnapshot({ status: 'running', taskCount: 5, ... });
 *
 * @param {SnapshotParams} params - Todos os dados do agente necessários para o snapshot
 * @returns {AgentStatusSnapshot} Snapshot do estado atual
 */
export function buildStatusSnapshot(params) {
    const {
        status,
        sessionId,
        model,
        reasoningEffort,
        queueSize,
        queueOldest,
        pendingQuestion,
        isResumed,
        resumeCount,
        sendCount,
        startedAt,
        contextWindow,
        lastCheckpointPath,
        permissionMode,
    } = params;

    const now = Date.now();
    const oldestWaitMs = queueOldest !== undefined ? now - queueOldest.enqueuedAt : 0;

    return {
        status,
        sessionId,
        model,
        reasoningEffort,
        queueSize,
        oldestTaskWaitMs: oldestWaitMs,
        starvationAlert: oldestWaitMs >= STARVATION_THRESHOLD_MS,
        pendingQuestion: pendingQuestion
            ? {
                  question: pendingQuestion.question,
                  choices: pendingQuestion.choices,
                  allowFreeform: pendingQuestion.allowFreeform,
                  askedAt: pendingQuestion.askedAt,
              }
            : null,
        isResumed,
        resumeCount,
        sendCount,
        startedAt,
        contextWindow,
        lastCheckpointPath,
        permissionMode,
    };
}
