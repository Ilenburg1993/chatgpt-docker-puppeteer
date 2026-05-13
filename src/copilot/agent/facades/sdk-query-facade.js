// @ts-check
/**
 * @module copilot/agent/facades/sdk-query-facade
 * @file Façade para queries e status do SDK.
 *
 *   Extração de 12 métodos async do AlwaysAliveAgent para reduzir complexidade.
 */

import {
    getForegroundSdkSessionId,
    getLastSdkSessionId,
    getSdkAuthStatus,
    getSdkQuota,
    getSdkSessionMode,
    getSdkStatus,
    listSdkBuiltInTools,
    listSdkModels,
    listSdkSessions,
    pingSdk,
    setForegroundSdkSessionId,
    setSdkSessionMode,
} from '../runtime/root-surface/index.js';

/**
 * Façade para SDK Query Operations.
 *
 * Agrupa métodos assíncronos de status, consultas e configuração do SDK:
 *
 * - pingSdk: Health check do SDK
 * - getSdk*: Status, auth, quota, models
 * - listSdk*: Sessions, models, tools
 * - *SdkSessionMode: Getter/setter do modo
 * - *ForegroundSdkSessionId: Getter/setter de sessão em foreground
 *
 * Todas as operações são delegações puras para runtime/root-surface/.
 *
 * @see module:copilot/agent/always-alive
 */
export class SdkQueryFacade {
    /**
     * @param {import('../agent-context.js').AgentContext} ctx
     */
    constructor(ctx) {
        this.ctx = ctx;
    }

    /**
     * Executa um ping no client SDK atualmente acoplado ao agent.
     *
     * @returns {Promise<{ message: string; timestamp: number; protocolVersion?: number }>}
     */
    async pingSdk() {
        return pingSdk(this.ctx);
    }

    /**
     * Retorna o status do runtime SDK/CLI acoplado ao agent.
     *
     * @returns {Promise<import('#copilot/sdk/types').GetStatusResponse>}
     */
    async getSdkStatus() {
        return getSdkStatus(this.ctx);
    }

    /**
     * Retorna o status de autenticação do runtime SDK/CLI acoplado ao agent.
     *
     * @returns {Promise<import('#copilot/sdk/types').GetAuthStatusResponse>}
     */
    async getSdkAuthStatus() {
        return getSdkAuthStatus(this.ctx);
    }

    /**
     * Lista modelos disponíveis via RPC server-scoped do SDK.
     *
     * @returns {Promise<unknown>}
     */
    async listSdkModels() {
        return listSdkModels(this.ctx);
    }

    /**
     * Lista tools expostas pelo runtime SDK/CLI, opcionalmente filtradas por modelo.
     *
     * @param {{ model?: string }} [options]
     * @returns {Promise<unknown>}
     */
    async listSdkBuiltInTools(options) {
        return listSdkBuiltInTools(this.ctx, options);
    }

    /**
     * Retorna snapshot de quota via RPC server-scoped do SDK.
     *
     * @returns {Promise<unknown>}
     */
    async getSdkQuota() {
        return getSdkQuota(this.ctx);
    }

    /**
     * Retorna o ID da última sessão conhecida pelo client SDK atual.
     *
     * @returns {Promise<string | undefined>}
     */
    async getLastSdkSessionId() {
        return getLastSdkSessionId(this.ctx);
    }

    /**
     * Retorna o sessionId em foreground no client SDK atual.
     *
     * @returns {Promise<string | undefined>}
     */
    async getForegroundSdkSessionId() {
        return getForegroundSdkSessionId(this.ctx);
    }

    /**
     * Define o sessionId em foreground no client SDK atual.
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async setForegroundSdkSessionId(sessionId) {
        await setForegroundSdkSessionId(this.ctx, sessionId);
    }

    /**
     * Lista sessões persistidas/acessíveis pelo client SDK atual.
     *
     * @param {import('#copilot/sdk/types').SessionListFilter} [filter]
     * @returns {Promise<import('#copilot/sdk/types').SessionMetadata[]>}
     */
    async listSdkSessions(filter) {
        return listSdkSessions(this.ctx, filter);
    }

    /**
     * Retorna o modo vanilla atual da sessão SDK (`interactive`, `plan`, `autopilot`).
     *
     * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
     */
    async getSdkSessionMode() {
        return getSdkSessionMode(this.ctx);
    }

    /**
     * Altera o modo vanilla da sessão SDK.
     *
     * @param {'interactive' | 'plan' | 'autopilot'} mode
     * @returns {Promise<import('#copilot/sdk/types').ModeResult>}
     */
    async setSdkSessionMode(mode) {
        return setSdkSessionMode(this.ctx, mode);
    }
}
