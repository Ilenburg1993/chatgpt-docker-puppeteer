// @ts-check
/**
 * @module copilot/agent/facades/health-facade
 * @file Façade para diagnósticos e observabilidade.
 *
 *   Extração de 5 métodos do AlwaysAliveAgent para reduzir complexidade.
 */

import { getAgentHealthSnapshot as healthSnapshot } from '../health-check.js';
import { getSdkHandles, getSdkResourceSnapshot } from './sdk-access.js';
import {
    getStatusSnapshot as stateSnapshot,
    listenerDiagnostics as stateDiagnostics,
} from '../state/agent-state.js';

/**
 * Façade para Health & Diagnostics.
 *
 * Agrupa métodos de observabilidade e diagnóstico:
 *
 * - getStatusSnapshot: Estado completo do agente
 * - getHealthSnapshot: Health consolidado
 * - getSdkHandles: Handles crus do SDK
 * - getSdkResourceSnapshot: Cobertura de recursos do SDK
 * - listenerDiagnostics: Diagnóstico de listeners (leak detection)
 *
 * Todas as operações são delegações puras para runtime/root-surface/.
 *
 * @see module:copilot/agent/always-alive
 */
export class HealthFacade {
    /**
     * @param {import('../agent-context.js').AgentContext} ctx
     * @param {import('../always-alive.js').AlwaysAliveAgent} agent
     */
    constructor(ctx, agent) {
        this.ctx = ctx;
        this.agent = agent;
    }

    /**
     * Retorna um snapshot do estado atual do agente para a API HTTP.
     *
     * G2-PERF-01: Dirty flag primário + TTL safety net. O cache é invalidado (null) em toda mutação de estado
     * (`#setStatus()`, `messageQueue.onChanged`, `stop()`). O TTL existe apenas como segurança para edge cases onde a
     * invalidação é perdida. O fallback persistido de sessionId continua canônico via façade de runtime-state.
     *
     * @returns {import('../types.js').AgentStatusSnapshot}
     */
    getStatusSnapshot() {
        return stateSnapshot(this.ctx, this.agent);
    }

    /**
     * Retorna um snapshot consolidado de health do agente.
     *
     * Usado por rotas de health, registries de observabilidade e diagnósticos operacionais.
     *
     * @returns {import('../types.js').AgentHealthSnapshot}
     */
    getHealthSnapshot() {
        return healthSnapshot(this.ctx, this.agent);
    }

    /**
     * Retorna os handles crus do SDK atualmente acoplados ao agent.
     *
     * @returns {import('../types.js').AgentSdkHandles}
     */
    getSdkHandles() {
        return getSdkHandles(this.ctx);
    }

    /**
     * Retorna um snapshot verificável da cobertura de recursos SDK disponíveis ao agent.
     *
     * @returns {import('../types.js').AgentSdkAccessSnapshot}
     */
    getSdkResourceSnapshot() {
        return getSdkResourceSnapshot(this.ctx);
    }

    /**
     * Retorna contagem de listeners por evento para diagnóstico de leaks.
     *
     * @returns {{ [event: string]: number }}
     */
    listenerDiagnostics() {
        return stateDiagnostics(this.agent);
    }
}
