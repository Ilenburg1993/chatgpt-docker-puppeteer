// @ts-check
/**
 * @module copilot/agent/facades/state-query-facade
 * @file Façade para leitura de estado runtime.
 *
 *   Extração de 14 getters do AlwaysAliveAgent para reduzir complexidade.
 */

import { container } from '#copilot/core';
import {
    METRICS_STORE,
    readRuntimeControlState,
    readRuntimeInteractionState,
    readRuntimeToolRegistry,
} from '../runtime/root-surface/index.js';

/**
 * Façade para State Query (leitura de estado).
 *
 * Agrupa todos os getters de estado vivo do AlwaysAliveAgent:
 *
 * - Control state: status, dialogLoopActive, queueSize
 * - Session ID e telemetry
 * - Tools registry
 * - Pending question e suas sombras persistidas
 *
 * Operações puras de leitura — sem mutação de estado.
 *
 * @see module:copilot/agent/always-alive
 */
export class StateQueryFacade {
    /**
     * @param {import('../agent-context.js').AgentContext} ctx
     */
    constructor(ctx) {
        this.ctx = ctx;
    }

    /**
     * Retorna o status atual do agente.
     *
     * @returns {import('../types.js').AgentStatus}
     */
    get status() {
        return /** @type {import('../types.js').AgentStatus} */ (readRuntimeControlState(this.ctx).status);
    }

    /**
     * Indica se o modo de diálogo contínuo está ativo (startDialogLoop foi chamado e ainda não foi parado).
     *
     * @returns {boolean}
     */
    get dialogLoopActive() {
        return readRuntimeControlState(this.ctx).dialogLoopActive;
    }

    /**
     * Retorna o número atual de tarefas enfileiradas aguardando processamento.
     *
     * @returns {number}
     */
    get queueSize() {
        return readRuntimeControlState(this.ctx).queueSize;
    }

    /**
     * Retorna a sessão ID da sessão ativa (ou null).
     *
     * @returns {string | null}
     */
    get sessionId() {
        return readRuntimeControlState(this.ctx).sessionId;
    }

    /**
     * Retorna o sumário de métricas da sessão atual.
     *
     * @returns {object}
     */
    get telemetry() {
        return container.resolve(METRICS_STORE).getSummary();
    }

    /**
     * Retorna o registry de tools da sessão atual.
     *
     * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
     */
    get toolsRegistry() {
        return readRuntimeToolRegistry(this.ctx);
    }

    /**
     * Retorna a pergunta pendente (se houver).
     *
     * @returns {import('../types.js').PendingQuestion | null}
     */
    get pendingQuestion() {
        return readRuntimeInteractionState(this.ctx).pendingQuestion;
    }

    /**
     * Retorna a classificação semântica da pergunta viva atual, quando houver.
     *
     * @returns {import('../types.js').PendingQuestionKind | null}
     */
    get pendingQuestionKind() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionKind;
    }

    /**
     * Retorna a sombra persistida de `ask_user` restaurada do disco, quando houver.
     *
     * @returns {import('../types.js').PendingQuestionShadow | null}
     */
    get pendingQuestionShadow() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadow;
    }

    /**
     * Retorna a classificação semântica da sombra persistida de `ask_user`, quando houver.
     *
     * @returns {import('../types.js').PendingQuestionKind | null}
     */
    get pendingQuestionShadowKind() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadowKind;
    }

    /**
     * Retorna o estado semântico atual da shadow persistida.
     *
     * @returns {import('../types.js').PendingQuestionShadowState | null}
     */
    get pendingQuestionShadowState() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadowState;
    }

    /**
     * Indica se a shadow persistida já expirou.
     *
     * @returns {boolean}
     */
    get pendingQuestionShadowExpired() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadowExpired;
    }

    /**
     * Retorna a idade atual da shadow persistida, em ms, quando houver.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowAgeMs() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadowAgeMs;
    }

    /**
     * Retorna o timestamp de expiração da shadow persistida, quando houver.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowExpiresAt() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadowExpiresAt;
    }

    /**
     * Retorna o tempo restante até a expiração da shadow persistida.
     *
     * @returns {number | null}
     */
    get pendingQuestionShadowRemainingMs() {
        return readRuntimeInteractionState(this.ctx).pendingQuestionShadowRemainingMs;
    }
}
