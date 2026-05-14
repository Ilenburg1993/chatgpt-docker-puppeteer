// @ts-check
/**
 * src/copilot/sdk/session/tool-session-context.js
 *
 * `ToolSessionContext` — estado canônico por sessão para o subsistema de tools.
 *
 * Elimina singletons module-level (`_pendingStructuredUserInputResolvers`, `_pendingStructuredUserInputSeq`) do
 * `user-input.js`, encapsulando o estado por instância de sessão. Cada sessão Copilot deve ter seu próprio
 * `ToolSessionContext`, garantindo isolamento em ambientes multi-sessão e facilitando a testabilidade.
 *
 * ## Uso recomendado
 *
 * ```js
 * const ctx = new ToolSessionContext({ sessionId: 'session-abc123' });
 *
 * // Em hook-tools.js, ao invés de usar funções globais de user-input:
 * const requestId = ctx.nextStructuredInputId();
 * ctx.registerPendingInput(requestId, resolve);
 * ctx.cancelAllPendingInput('[session encerrada]');
 * ```
 *
 * ## Contexto default
 *
 * `user-input.js` mantém helpers que operam sobre um `ToolSessionContext` default configurável no bootstrap. Consumers
 * multi-sessão devem injetar a instância por sessão para preservar isolamento.
 *
 * @module copilot/sdk/session/tool-session-context
 */

/**
 * Resolver de input estruturado (`request_user_input`).
 *
 * @typedef {(answer: string) => void} StructuredInputResolver
 */

/**
 * Opções de criação de `ToolSessionContext`.
 *
 * @typedef {object} ToolSessionContextOptions
 * @property {string} [sessionId] - ID da sessão Copilot, para rastreabilidade em logs/auditoria.
 * @property {(event: string, data: Record<string, unknown>) => void} [broadcastSse] - Callback de broadcast SSE.
 *   Injetado via `ToolSessionContext` para evitar import circular com a borda de diálogo do terminal.
 */

/**
 * Snapshot observável do estado de um `ToolSessionContext`.
 *
 * @typedef {object} ToolSessionContextSnapshot
 * @property {string | null} sessionId
 * @property {number} pendingInputCount
 * @property {string[]} pendingInputIds
 * @property {boolean} hasBroadcastSse
 */

/**
 * Contexto canônico de estado por sessão para o subsistema de tools.
 *
 * Encapsula:
 *
 * - Resolvers de input estruturado pendentes (`request_user_input`)
 * - Callback de broadcast SSE (anti-import-circular)
 * - Contador sequencial de IDs de request
 */
export class ToolSessionContext {
    /** @type {string | null} */
    #sessionId;

    /** @type {Map<string, StructuredInputResolver>} */
    #pendingInputResolvers;

    /** @type {number} */
    #pendingInputSeq;

    /** @type {(event: string, data: Record<string, unknown>) => void} */
    #broadcastSse;

    /** @type {boolean} - Rastreia se há callback ativo (evita comparação de referência) */
    #hasActiveBroadcast;

    /**
     * @param {ToolSessionContextOptions} [opts]
     */
    constructor(opts = {}) {
        this.#sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : null;
        this.#pendingInputResolvers = new Map();
        this.#pendingInputSeq = 0;
        this.#hasActiveBroadcast = typeof opts.broadcastSse === 'function';
        this.#broadcastSse = typeof opts.broadcastSse === 'function' ? opts.broadcastSse : () => {};
    }

    // ─── ID & Session ─────────────────────────────────────────────────────────

    /**
     * ID da sessão, ou null se não configurado.
     *
     * @returns {string | null}
     */
    get sessionId() {
        return this.#sessionId;
    }

    // ─── Broadcast SSE ────────────────────────────────────────────────────────

    /**
     * Injeta callback de broadcast SSE. Pode ser chamado após a construção inicial quando o terminal é inicializado
     * (evita import circular).
     *
     * @param {(event: string, data: Record<string, unknown>) => void} fn
     * @returns {void}
     */
    configureBroadcastSse(fn) {
        if (typeof fn !== 'function') return;
        this.#hasActiveBroadcast = true;
        this.#broadcastSse = fn;
    }

    /**
     * Emite um evento SSE via callback configurado (no-op se não configurado).
     *
     * @param {string} event
     * @param {Record<string, unknown>} data
     * @returns {void}
     */
    broadcastSse(event, data) {
        try {
            this.#broadcastSse(event, data);
        } catch (_) {
            // ignora erros no broadcast — não deve interromper fluxo de tools
        }
    }

    // ─── Structured Input (request_user_input) ────────────────────────────────

    /**
     * Gera um ID canônico para requests de input estruturado — único por instância de contexto.
     *
     * @returns {string}
     */
    nextStructuredInputId() {
        this.#pendingInputSeq += 1;
        return `request-user-input-${Date.now().toString(36)}-${this.#pendingInputSeq.toString(36)}`;
    }

    /**
     * Registra um resolver pendente para `request_user_input`.
     *
     * @param {string} requestId
     * @param {StructuredInputResolver} resolve
     * @returns {void}
     */
    registerPendingInput(requestId, resolve) {
        this.#pendingInputResolvers.set(requestId, resolve);
    }

    /**
     * Remove um resolver pendente pelo ID.
     *
     * @param {string} requestId
     * @returns {boolean}
     */
    deletePendingInput(requestId) {
        return this.#pendingInputResolvers.delete(requestId);
    }

    /**
     * Resolve um pending input estruturado específico, ou o mais antigo se `requestId` for omitido.
     *
     * @param {string} answer
     * @param {string} [requestId]
     * @returns {boolean}
     */
    resolveStructuredInput(answer, requestId) {
        if (this.#pendingInputResolvers.size === 0) return false;

        if (requestId) {
            const resolve = this.#pendingInputResolvers.get(requestId);
            if (!resolve) return false;
            this.#pendingInputResolvers.delete(requestId);
            resolve(answer);
            return true;
        }

        // Resolve o mais antigo
        const oldest = this.#pendingInputResolvers.entries().next();
        if (oldest.done) return false;
        const [oldestId, resolve] = oldest.value;
        this.#pendingInputResolvers.delete(oldestId);
        resolve(answer);
        return true;
    }

    /**
     * IDs de todos os requests de input estruturado pendentes.
     *
     * @returns {string[]}
     */
    getPendingInputIds() {
        return [...this.#pendingInputResolvers.keys()];
    }

    /**
     * Número de requests de input estruturado pendentes.
     *
     * @returns {number}
     */
    getPendingInputCount() {
        return this.#pendingInputResolvers.size;
    }

    /**
     * Retorna true se houver ao menos um request de input estruturado pendente.
     *
     * @returns {boolean}
     */
    hasPendingInputs() {
        return this.#pendingInputResolvers.size > 0;
    }

    /**
     * Cancela (resolve) todos os requests pendentes com a mesma resposta padrão. Usado em teardown de sessão para
     * evitar Promise leaks.
     *
     * @param {string} answer - Resposta padrão enviada aos resolvers cancelados.
     * @returns {number} Número de resolvers cancelados.
     */
    cancelAllPendingInput(answer) {
        if (this.#pendingInputResolvers.size === 0) return 0;
        const resolvers = [...this.#pendingInputResolvers.values()];
        this.#pendingInputResolvers.clear();
        for (const resolve of resolvers) {
            resolve(answer);
        }
        return resolvers.length;
    }

    // ─── Observabilidade ──────────────────────────────────────────────────────

    /**
     * Retorna um snapshot observável do estado atual do contexto (sem expor internals).
     *
     * @returns {ToolSessionContextSnapshot}
     */
    snapshot() {
        return {
            sessionId: this.#sessionId,
            pendingInputCount: this.#pendingInputResolvers.size,
            pendingInputIds: [...this.#pendingInputResolvers.keys()],
            hasBroadcastSse: this.#hasActiveBroadcast,
        };
    }
}

/**
 * Cria um `ToolSessionContext` com as opções fornecidas.
 *
 * @param {ToolSessionContextOptions} [opts]
 * @returns {ToolSessionContext}
 */
export function createToolSessionContext(opts = {}) {
    return new ToolSessionContext(opts);
}
