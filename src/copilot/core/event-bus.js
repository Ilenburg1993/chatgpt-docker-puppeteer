// @ts-check
/**
 * src/copilot/core/event-bus.js
 *
 * Event Bus cross-module com suporte a namespaces, wildcards e middleware.
 *
 * Características:
 *
 * - Typed events via JSDoc + catálogo em `types/events.js`
 * - Namespaces: `session:start`, `tool:pre_invoke`, etc.
 * - Wildcards: `session:*`, `*` (catch-all)
 * - Middleware chain: interceptar/transformar eventos antes da entrega
 * - Observable: contadores de eventos para métricas
 * - Integrável com DI container via token EVENT_BUS
 *
 * @module copilot/core/event-bus
 */

/**
 * @typedef {import('../events/legacy-events.js').BaseEvent} BaseEvent
 */

/**
 * @callback EventHandler
 * @param {BaseEvent} event
 * @returns {void | Promise<void>}
 */

/**
 * @callback Middleware
 * @param {BaseEvent} event
 * @param {() => void} next
 * @returns {void}
 */

// ─── EventBus ────────────────────────────────────────────────────────────────

/**
 * Bus de eventos cross-module. Substitui EventEmitter ad-hoc por um bus centralizado com namespaces, wildcards e
 * middleware.
 *
 * Implementa {@link import('./interfaces.js').IEventBus IEventBus} (Faixa 3.2 — AC-5-02).
 *
 * @see module:copilot/core/interfaces
 */
export class EventBus {
    /** @type {Map<string, Set<EventHandler>>} */
    #listeners = new Map();

    /** @type {Middleware[]} */
    #middleware = [];

    /** @type {Map<string, number>} */
    #counters = new Map();

    /** @type {boolean} */
    #disposed = false;

    /**
     * Registra um handler para um event type. Suporta wildcards: `session:*` captura todos os eventos `session:*`.
     *
     * @param {string} eventType - Nome do evento ou padrão com wildcard.
     * @param {EventHandler} handler
     * @returns {() => void} Função de unsubscribe.
     */
    on(eventType, handler) {
        if (this.#disposed) throw new Error('[EventBus] Cannot subscribe on disposed bus');
        if (typeof eventType !== 'string' || !eventType) {
            throw new TypeError('[EventBus] eventType must be a non-empty string');
        }
        if (typeof handler !== 'function') {
            throw new TypeError('[EventBus] handler must be a function');
        }

        let set = this.#listeners.get(eventType);
        if (!set) {
            set = new Set();
            this.#listeners.set(eventType, set);
        }
        set.add(handler);

        return () => {
            set?.delete(handler);
            if (set?.size === 0) this.#listeners.delete(eventType);
        };
    }

    /**
     * Registra um handler que dispara apenas uma vez.
     *
     * @param {string} eventType
     * @param {EventHandler} handler
     * @returns {() => void} Função de unsubscribe.
     */
    once(eventType, handler) {
        /** @type {(() => void) | null} */
        let unsub = null;
        /** @type {EventHandler} */
        const wrapper = (event) => {
            unsub?.();
            void handler(event);
        };
        unsub = this.on(eventType, wrapper);
        return unsub;
    }

    /**
     * Emite um evento, passando por middleware e notificando handlers. Se `timestamp` não for fornecido, será
     * preenchido automaticamente.
     *
     * @param {{ type: string; timestamp?: number; [key: string]: unknown }} rawEvent
     */
    emit(rawEvent) {
        if (this.#disposed) return;
        if (!rawEvent || typeof rawEvent.type !== 'string') {
            throw new TypeError('[EventBus] event must have a string "type" property');
        }

        // Auto-fill timestamp if not provided
        if (!rawEvent.timestamp) {
            rawEvent.timestamp = Date.now();
        }

        /** @type {BaseEvent} */
        const event = /** @type {BaseEvent} */ (/** @type {unknown} */ (rawEvent));

        // Increment counter
        this.#counters.set(event.type, (this.#counters.get(event.type) ?? 0) + 1);

        // Run middleware chain
        let idx = 0;
        const mw = this.#middleware;
        const deliver = () => {
            if (idx < mw.length) {
                const fn = mw[idx++];
                if (fn) fn(event, deliver);
            } else {
                this.#deliver(event);
            }
        };
        deliver();
    }

    /**
     * Adiciona um middleware ao pipeline. Middlewares são executados na ordem de adição, antes da entrega aos handlers.
     *
     * @param {Middleware} fn
     */
    use(fn) {
        if (this.#disposed) throw new Error('[EventBus] Cannot add middleware on disposed bus');
        if (typeof fn !== 'function') {
            throw new TypeError('[EventBus] middleware must be a function');
        }
        this.#middleware.push(fn);
    }

    /**
     * Retorna contagem de vezes que um eventType foi emitido.
     *
     * @param {string} eventType
     * @returns {number}
     */
    count(eventType) {
        return this.#counters.get(eventType) ?? 0;
    }

    /**
     * Retorna snapshot dos contadores de todos os eventos.
     *
     * @returns {Record<string, number>}
     */
    stats() {
        return Object.fromEntries(this.#counters);
    }

    /**
     * Retorna contadores agrupados por namespace (parte antes do primeiro ':').
     *
     * @returns {Record<string, number>}
     */
    statsByNamespace() {
        /** @type {Record<string, number>} */
        const result = {};
        for (const [type, count] of this.#counters) {
            const colonIdx = type.indexOf(':');
            const ns = colonIdx > 0 ? type.slice(0, colonIdx) : '_global';
            result[ns] = (result[ns] ?? 0) + count;
        }
        return result;
    }

    /**
     * Retorna diagnóstico completo do bus em runtime.
     *
     * @returns {{
     *     listeners: { type: string; count: number }[];
     *     emitted: Record<string, number>;
     *     disposed: boolean;
     *     middlewareCount: number;
     *     totalListeners: number;
     * }}
     */
    diagnostics() {
        return {
            listeners: Array.from(this.#listeners.entries()).map(([type, set]) => ({
                type,
                count: set.size,
            })),
            emitted: Object.fromEntries(this.#counters),
            disposed: this.#disposed,
            middlewareCount: this.#middleware.length,
            totalListeners: this.listenerCount,
        };
    }

    /**
     * Retorna lista de event types com pelo menos 1 subscriber ativo.
     *
     * @returns {string[]}
     */
    channels() {
        return Array.from(this.#listeners.keys()).filter((k) => (this.#listeners.get(k)?.size ?? 0) > 0);
    }

    /**
     * Remove todos os listeners e middleware. EventBus fica inoperante.
     */
    dispose() {
        this.#listeners.clear();
        this.#middleware.length = 0;
        this.#counters.clear();
        this.#disposed = true;
    }

    /**
     * Número total de listeners registrados.
     *
     * @returns {number}
     */
    get listenerCount() {
        let total = 0;
        for (const set of this.#listeners.values()) total += set.size;
        return total;
    }

    /**
     * Entrega o evento aos handlers exatos + wildcard.
     *
     * @param {BaseEvent} event
     */
    #deliver(event) {
        const type = event.type;

        // Exact match
        const exact = this.#listeners.get(type);
        if (exact) {
            for (const handler of exact) {
                try {
                    void handler(event);
                } catch (_) {
                    /* handler errors are swallowed */
                }
            }
        }

        // Namespace wildcard: `session:*` matches `session:start`
        const colonIdx = type.indexOf(':');
        if (colonIdx > 0) {
            const ns = type.slice(0, colonIdx);
            const wildcard = this.#listeners.get(`${ns}:*`);
            if (wildcard) {
                for (const handler of wildcard) {
                    try {
                        void handler(event);
                    } catch (_) {
                        /* handler errors are swallowed */
                    }
                }
            }
        }

        // Global catch-all: `*`
        const catchAll = this.#listeners.get('*');
        if (catchAll) {
            for (const handler of catchAll) {
                try {
                    void handler(event);
                } catch (_) {
                    /* handler errors are swallowed */
                }
            }
        }
    }
}

/**
 * Cria uma nova instância de EventBus.
 *
 * @returns {EventBus}
 */
export function createEventBus() {
    return new EventBus();
}

// ─── M-3: Bridge EventEmitter ad-hoc → EventBus ─────────────────────────────

/**
 * Conecta um EventEmitter convencional ao EventBus centralizado, re-emitindo eventos selecionados.
 *
 * Para cada `eventName` no mapa, registra um listener no `emitter` que chama `bus.emit()` com o `type` correspondente e
 * o payload original como propriedades espalhadas.
 *
 * @example
 *     ```js
 *     // Re-emite 'SESSION_CREATED' do Orchestrator como HUB_SESSION_CREATED no EventBus
 *     bridgeEmitter(orchestrator, eventBus, {
 *         [HUB_EVENTS.SESSION_CREATED]: HUB_SESSION_CREATED,
 *     });
 *     ```;
 *
 * @param {import('node:events').EventEmitter} emitter - Fonte de eventos local.
 * @param {EventBus} bus - Destino centralizado.
 * @param {Record<string, string>} eventMap - Mapa `{ localEventName: 'bus:type' }`.
 * @returns {() => void} Função para remover todos os listeners registrados.
 */
export function bridgeEmitter(emitter, bus, eventMap) {
    /** @type {{ event: string; handler: (...args: unknown[]) => void }[]} */
    const bindings = [];

    for (const [localEvent, busType] of Object.entries(eventMap)) {
        /** @param {unknown[]} args */
        const handler = (...args) => {
            const payload = args[0] && typeof args[0] === 'object' ? args[0] : {};
            bus.emit({ type: busType, .../** @type {Record<string, unknown>} */ (payload) });
        };
        emitter.on(localEvent, handler);
        bindings.push({ event: localEvent, handler });
    }

    return () => {
        for (const { event, handler } of bindings) {
            emitter.removeListener(event, handler);
        }
    };
}
