// @ts-check
/**
 * src/copilot/services/session-service.js
 *
 * Fachada de alto nível para operações de sessão, consolidando sdk + observability + core.
 *
 * Consumidores (api/, terminal/) podem usar esta fachada em vez de importar diretamente os subsistemas, reduzindo
 * fan-out e centralizando lógica transversal (logging, eventos).
 *
 * @module copilot/services/session-service
 */

import { container, EVENT_BUS } from '#copilot/core';
import { log } from '#copilot/observability';
import {
    approveAll,
    createClientSession,
    disconnectClientSession,
    getClient,
    getClientSession,
    getClientState,
    incrementSessionMessageCount,
    listActiveClientSessions,
    pickDefined,
    resumeClientSession,
    stopClient,
} from '#copilot/sdk';

// Re-exportar utilitários do SDK usados pelas routes (evita que api/ dependa diretamente de #copilot/sdk)
export { approveAll, pickDefined };

/**
 * Fachada de sessão — consolida operações do SDK com logging e eventos.
 */
export class SessionService {
    /** @type {import('../core/event-bus.js').EventBus | null} */
    #eventBus = null;

    /**
     * Obtém EventBus (lazy — pode não estar registrado em testes).
     *
     * @returns {import('../core/event-bus.js').EventBus | null}
     */
    #bus() {
        if (!this.#eventBus) {
            try {
                this.#eventBus = container.resolve(EVENT_BUS);
            } catch {
                // EventBus não registrado — operar sem eventos
            }
        }
        return this.#eventBus;
    }

    /**
     * Lista sessões ativas em memória.
     *
     * @returns {{ sessionId: string; model: string; createdAt: number; messagesCount: number; activeMs: number }[]}
     */
    listActive() {
        return listActiveClientSessions().map(({ sessionId, model, createdAt, messagesCount }) => ({
            sessionId,
            model,
            createdAt,
            messagesCount,
            activeMs: Date.now() - createdAt,
        }));
    }

    /**
     * Obtém o CopilotClient singleton.
     *
     * @returns {Promise<any>}
     */
    async getClient() {
        return getClient();
    }

    /**
     * Cria uma nova sessão SDK.
     *
     * @param {any} config - SessionConfig completo do SDK.
     * @returns {Promise<any>}
     */
    async createSession(config) {
        log('INFO', `[SessionService] criando sessão com model=${config.model ?? 'default'}`);
        const session = await createClientSession(config);
        this.#bus()?.emit({ type: 'session:create' });
        return session;
    }

    /**
     * Obtém sessão por ID.
     *
     * @param {string} sessionId
     * @returns {any}
     */
    getSession(sessionId) {
        return getClientSession(sessionId);
    }

    /**
     * Desconecta uma sessão.
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async disconnectSession(sessionId) {
        log('INFO', `[SessionService] desconectando sessão ${sessionId}`);
        await disconnectClientSession(sessionId);
        this.#bus()?.emit({ type: 'session:disconnect' });
    }

    /**
     * Retoma uma sessão existente.
     *
     * @param {string} sessionId
     * @param {any} [config] - ResumeSessionConfig do SDK.
     * @returns {Promise<any>}
     */
    async resumeSession(sessionId, config) {
        log('INFO', `[SessionService] retomando sessão ${sessionId}`);
        const session = await resumeClientSession(sessionId, config);
        this.#bus()?.emit({ type: 'session:resume' });
        return session;
    }

    /**
     * Lista sessões no disco com filtro opcional.
     *
     * @param {any} [filter]
     * @returns {Promise<any[]>}
     */
    async listSessions(filter) {
        const client = await getClient();
        return client.listSessions(filter);
    }

    /**
     * Obtém o ID da última sessão.
     *
     * @returns {Promise<string | null>}
     */
    async getLastSessionId() {
        const client = await getClient();
        return (await client.getLastSessionId()) ?? null;
    }

    /**
     * Obtém o sessionId da sessão em foreground.
     *
     * @returns {Promise<string | null>}
     */
    async getForegroundSessionId() {
        const client = await getClient();
        return (await client.getForegroundSessionId()) ?? null;
    }

    /**
     * Define a sessão em foreground.
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async setForegroundSessionId(sessionId) {
        const client = await getClient();
        await client.setForegroundSessionId(sessionId);
        log('INFO', `[SessionService] foreground session: ${sessionId}`);
    }

    /**
     * Obtém o estado atual do CopilotClient.
     *
     * @returns {any}
     */
    getClientState() {
        return getClientState();
    }

    /**
     * Para o CopilotClient.
     *
     * @returns {Promise<void>}
     */
    async stopClient() {
        log('INFO', '[SessionService] stopping client');
        await stopClient();
    }

    /**
     * Incrementa contador de mensagens de uma sessão.
     *
     * @param {string} sessionId
     * @returns {void}
     */
    incrementMessageCount(sessionId) {
        incrementSessionMessageCount(sessionId);
    }
}

/**
 * Cria instância de SessionService.
 *
 * @returns {SessionService}
 */
export function createSessionService() {
    return new SessionService();
}
