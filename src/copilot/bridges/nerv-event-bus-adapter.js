// @ts-check
/**
 * src/copilot/bridges/nerv-event-bus-adapter.js
 *
 * FAIXA-L3 — Adapter que faz relay bidirecional EventBus ↔ NERV.
 *
 * Escuta o **EventBus centralizado**, capturando TODOS os eventos (hooks, hub, services, system) — não só os do agent.
 * É a única ponte com NERV.
 *
 * @module copilot/bridges/nerv-event-bus-adapter
 * @see module:copilot/events/nerv-events
 */

import { EVENTBUS_TO_NERV, NERV_COMMAND_RECEIVED, NERV_COMMAND_TO_EVENTBUS } from '#copilot/events';
import { log } from '#copilot/observability';

/**
 * @typedef {import('../core/event-bus.js').EventBus} EventBus
 */

/**
 * @typedef {object} NervInstance
 * @property {(envelope: any) => Promise<void>} emitEvent
 * @property {((actionCode: string, handler: (envelope: any) => void) => () => void) | undefined} [onEvent]
 */

export class NervEventBusAdapter {
    /** @type {EventBus | null} */
    #bus = null;

    /** @type {NervInstance | null} */
    #nerv = null;

    /** @type {(() => void)[]} */
    #unsubscribers = [];

    /** @type {(() => void) | null} */
    #inboundUnsub = null;

    /** @type {boolean} */
    #mounted = false;

    /**
     * Monta o adapter ligando EventBus → NERV (outbound) e NERV → EventBus (inbound).
     *
     * @param {EventBus} bus - EventBus centralizado
     * @param {NervInstance} nerv - Instância NERV com `emitEvent`
     * @returns {void}
     */
    mount(bus, nerv) {
        if (this.#mounted) {
            log('WARN', '[nerv-adapter] mount() duplicado — remontando.');
            this.unmount();
        }
        this.#bus = bus;
        this.#nerv = nerv;
        this.#mounted = true;

        this.#attachOutbound();
        this.#attachInbound();

        log('INFO', `[nerv-adapter] Montado — ${this.#unsubscribers.length} outbound subscriptions.`);
    }

    /**
     * Remove todas as subscriptions e libera referências.
     *
     * @returns {void}
     */
    unmount() {
        for (const unsub of this.#unsubscribers) {
            try {
                unsub();
            } catch {
                /* ignore */
            }
        }
        this.#unsubscribers = [];

        if (this.#inboundUnsub) {
            try {
                this.#inboundUnsub();
            } catch {
                /* ignore */
            }
            this.#inboundUnsub = null;
        }

        this.#bus = null;
        this.#nerv = null;
        this.#mounted = false;
        log('INFO', '[nerv-adapter] Desmontado.');
    }

    /** @returns {boolean} */
    get isMounted() {
        return this.#mounted;
    }

    // ── Outbound: EventBus → NERV ──────────────────────────────────────────

    /**
     * @returns {void}
     */
    #attachOutbound() {
        const bus = this.#bus;
        if (!bus) return;

        for (const [eventType, actionCode] of Object.entries(EVENTBUS_TO_NERV)) {
            const unsub = bus.on(eventType, (/** @type {Record<string, unknown>} */ event) => {
                this.#safeEmitNerv(actionCode, event);
            });
            this.#unsubscribers.push(unsub);
        }
    }

    /**
     * Emite envelope NERV de forma segura (fire-and-forget, captura erros).
     *
     * @param {string} actionCode
     * @param {Record<string, unknown>} payload
     * @returns {void}
     */
    #safeEmitNerv(actionCode, payload) {
        if (!this.#nerv) return;
        const envelope = {
            actor: 'copilot:eventbus',
            actionCode,
            messageType: 'EVENT',
            payload: { ...payload },
            timestamp: Date.now(),
        };
        Promise.resolve(this.#nerv.emitEvent(envelope)).catch((/** @type {any} */ e) => {
            log('WARN', `[nerv-adapter] Falha ao emitir ${actionCode}: ${e?.message ?? String(e)}`);
        });
    }

    /**
     * Emite um evento ad-hoc no NERV (para uso por módulos que não passam pelo EventBus).
     *
     * @param {string} actionCode - Código da ação NERV (ex: 'copilot:turn:sent')
     * @param {Record<string, unknown>} payload - Dados do evento
     * @returns {void}
     */
    emitNerv(actionCode, payload) {
        this.#safeEmitNerv(actionCode, payload);
    }

    // ── Inbound: NERV → EventBus ───────────────────────────────────────────

    /**
     * @returns {void}
     */
    #attachInbound() {
        const nerv = this.#nerv;
        const bus = this.#bus;
        if (!nerv || !bus || typeof nerv.onEvent !== 'function') return;

        this.#inboundUnsub = nerv.onEvent('COPILOT_COMMAND', (/** @type {any} */ envelope) => {
            const command = envelope?.payload?.command;
            if (typeof command !== 'string') {
                log('WARN', '[nerv-adapter:inbound] Comando sem string command.');
                return;
            }

            // Emite evento genérico de recebimento
            bus.emit({ type: NERV_COMMAND_RECEIVED, command, payload: envelope.payload });

            // Emite evento específico se mapeado
            const busType = NERV_COMMAND_TO_EVENTBUS[command];
            if (busType) {
                bus.emit({ type: busType, ...envelope.payload });
            } else {
                log('WARN', `[nerv-adapter:inbound] Comando não mapeado: ${command}`);
            }
        });
    }
}

/**
 * Instância singleton do adapter.
 *
 * @type {NervEventBusAdapter}
 */
export const nervEventBusAdapter = new NervEventBusAdapter();

/**
 * Emite um evento ad-hoc no NERV via o adapter singleton.
 *
 * @param {string} actionCode
 * @param {Record<string, unknown>} payload
 * @returns {void}
 */
export function emitNerv(actionCode, payload) {
    nervEventBusAdapter.emitNerv(actionCode, payload);
}
