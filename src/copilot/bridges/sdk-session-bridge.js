// @ts-check
/**
 * src/copilot/bridges/sdk-session-bridge.js
 *
 * FAIXA-L5 — Bridge que conecta SDK CopilotSession events ao EventBus centralizado.
 *
 * Quando uma sessão SDK é criada/obtida, chama-se `bridge.attach(session)` para
 * subscrever os ~18 eventos de alto valor e reemiti-los no EventBus.
 *
 * Suporta múltiplas sessões concorrentes e cleanup via `detach(session)`.
 *
 * @module copilot/bridges/sdk-session-bridge
 */

import { SDK_SESSION_TO_EVENTBUS } from '#copilot/events/sdk-events.js';
import { log } from '#copilot/observability';
import { onSessionEvents } from '#copilot/sdk';

/**
 * @typedef {import('../core/event-bus.js').EventBus} EventBus
 * @typedef {import('../sdk/types.js').CopilotSession} CopilotSession
 */

export class SdkSessionBridge {
    /** @type {EventBus | null} */
    #bus = null;

    /** @type {Map<any, () => void>} session → unsub */
    #attached = new Map();

    /**
     * Inicializa o bridge com o EventBus.
     *
     * @param {EventBus} bus
     */
    init(bus) {
        this.#bus = bus;
    }

    /**
     * Anexa uma session SDK ao EventBus.
     * Subscreve os eventos listados em SDK_SESSION_TO_EVENTBUS e faz relay.
     *
     * @param {CopilotSession} session
     * @returns {void}
     */
    attach(session) {
        if (!this.#bus) {
            log('WARN', '[sdk-session-bridge] attach() chamado sem init() — ignorando.');
            return;
        }
        if (this.#attached.has(session)) {
            log('WARN', '[sdk-session-bridge] Session já attached — ignorando.');
            return;
        }

        /** @type {Record<string, (event: any) => void>} */
        const handlerMap = {};
        const bus = this.#bus;

        for (const [sdkType, busType] of Object.entries(SDK_SESSION_TO_EVENTBUS)) {
            handlerMap[sdkType] = (/** @type {any} */ evt) => {
                bus.emit({
                    type: busType,
                    sdkEventType: sdkType,
                    timestamp: Date.now(),
                    ...(evt?.data ?? {}),
                });
            };
        }

        const unsub = onSessionEvents(session, handlerMap);
        this.#attached.set(session, unsub);
        log('INFO', `[sdk-session-bridge] Session attached — ${Object.keys(handlerMap).length} events bridged.`);
    }

    /**
     * Desanexa uma session SDK, removendo todos os subscribers.
     *
     * @param {CopilotSession} session
     * @returns {void}
     */
    detach(session) {
        const unsub = this.#attached.get(session);
        if (unsub) {
            try { unsub(); } catch { /* ignore */ }
            this.#attached.delete(session);
            log('INFO', '[sdk-session-bridge] Session detached.');
        }
    }

    /**
     * Desanexa todas as sessions.
     *
     * @returns {void}
     */
    detachAll() {
        for (const [session] of this.#attached) {
            this.detach(session);
        }
    }

    /** @returns {number} */
    get attachedCount() {
        return this.#attached.size;
    }
}

/**
 * Instância singleton.
 *
 * @type {SdkSessionBridge}
 */
export const sdkSessionBridge = new SdkSessionBridge();
