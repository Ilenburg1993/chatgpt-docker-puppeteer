/* ==========================================================================
   src/nerv/transport/hybrid_transport.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: transport/
   Arquivo: hybrid_transport.js (ONDA 2.6)

   Papel:
   - Implementar transporte híbrido: local (EventEmitter) + remoto (Socket.io)
   - Rotear mensagens locais via EventEmitter (0 latência)
   - Rotear mensagens remotas via Socket.io (para SERVER/Dashboard)
   - Fornecer interface unificada para NERV

   IMPORTANTE:
   - Modo LOCAL: EventEmitter puro (in-process, sem Socket.io)
   - Modo HYBRID: EventEmitter + Socket.io (local fast-path + remoto)
   - NÃO interpreta envelopes
   - NÃO valida mensagens
   - NÃO conhece Kernel, Driver ou Server

   Linguagem: JavaScript (Node.js)
========================================================================== */

const EventEmitter = require('events');

const {
    CONNECTION_MODES: CONNECTION_MODES
} = require('../../core/constants/browser.js');

/**
 * Cria transporte híbrido com suporte local + remoto.
 *
 * @param {Object} config
 * @param {string} config.mode - 'local' | 'hybrid'
 * @param {Object} [config.socketAdapter] - Adapter Socket.io (se mode='hybrid')
 * @param {Object} config.telemetry - Interface de telemetria NERV
 */
function createHybridTransport({ mode = CONNECTION_MODES.LOCAL, socketAdapter = null, telemetry }) {
    if (!telemetry) {
        throw new Error('HybridTransport requer telemetry');
    }

    // Bus local (EventEmitter) para comunicação in-process
    const localBus = new EventEmitter();
    localBus.setMaxListeners(100); // Suporta muitos listeners

    // Handlers registrados
    const handlers = new Map();
    let handlerIdCounter = 0;

    /**
     * Inicia transporte (conecta Socket.io se híbrido).
     */
    function start() {
        telemetry.emit('hybrid_transport_start', { mode });

        if (mode === CONNECTION_MODES.HYBRID && socketAdapter) {
            // Configura recepção remota
            socketAdapter.onReceive(frame => {
                try {
                    const envelope = JSON.parse(frame);

                    // Emite no bus local também (para listeners locais)
                    localBus.emit('message', envelope);

                    // Notifica handlers registrados
                    handlers.forEach(handler => {
                        try {
                            handler(envelope);
                        } catch (err) {
                            telemetry.emit('hybrid_transport_handler_error', {
                                error: err.message
                            });
                        }
                    });
                } catch (err) {
                    telemetry.emit('hybrid_transport_parse_error', {
                        error: err.message
                    });
                }
            });

            socketAdapter.start();
        }
    }

    /**
     * Para transporte (desconecta Socket.io se híbrido).
     */
    function stop() {
        telemetry.emit('hybrid_transport_stop', { mode });

        if (mode === CONNECTION_MODES.HYBRID && socketAdapter) {
            socketAdapter.stop();
        }

        localBus.removeAllListeners();
        handlers.clear();
    }

    /**
     * Envia mensagem (local via EventEmitter, remoto via Socket.io).
     *
     * @param {Object} envelope - Envelope NERV normalizado
     */
    function send(envelope) {
        // 1. SEMPRE emite local (fast-path para mesmos processo)
        localBus.emit('message', envelope);

        // 2. Se híbrido, também envia via Socket.io
        if (mode === CONNECTION_MODES.HYBRID && socketAdapter) {
            try {
                const frame = JSON.stringify(envelope);
                socketAdapter.send(frame);
            } catch (err) {
                telemetry.emit('hybrid_transport_send_error', {
                    error: err.message
                });
            }
        }

        telemetry.emit('hybrid_transport_sent', {
            actor: envelope.actor,
            actionCode: envelope.actionCode,
            mode: mode === CONNECTION_MODES.HYBRID ? 'local+remote' : CONNECTION_MODES.LOCAL
        });
    }

    /**
     * Registra handler para receber mensagens.
     *
     * @param {Function} handler - (envelope) => void
     * @returns {Function} Unsubscribe function
     */
    function onReceive(handler) {
        if (typeof handler !== 'function') {
            throw new Error('onReceive requer função');
        }

        const handlerId = handlerIdCounter++;
        handlers.set(handlerId, handler);

        // Também escuta no bus local
        localBus.on('message', handler);

        // Retorna função de unsubscribe
        return () => {
            handlers.delete(handlerId);
            localBus.off('message', handler);
        };
    }

    /**
     * Registra listener para actionCode específico.
     *
     * @param {string} actionCode - Código de ação (ex: 'TASK_START')
     * @param {Function} handler - (envelope) => void
     * @returns {Function} Unsubscribe function
     */
    function onEvent(actionCode, handler) {
        if (typeof handler !== 'function') {
            throw new Error('onEvent requer função');
        }

        const wrappedHandler = envelope => {
            if (envelope.actionCode === actionCode) {
                handler(envelope);
            }
        };

        return onReceive(wrappedHandler);
    }

    /**
     * Registra listener para actor específico.
     *
     * @param {string} actor - Actor (ex: 'KERNEL', 'DRIVER', 'SERVER')
     * @param {Function} handler - (envelope) => void
     * @returns {Function} Unsubscribe function
     */
    function onActor(actor, handler) {
        if (typeof handler !== 'function') {
            throw new Error('onActor requer função');
        }

        const wrappedHandler = envelope => {
            if (envelope.actor === actor) {
                handler(envelope);
            }
        };

        return onReceive(wrappedHandler);
    }

    /**
     * Retorna status de conectividade.
     */
    function getStatus() {
        const status = {
            mode,
            localBus: 'active',
            handlers: handlers.size
        };

        if (mode === CONNECTION_MODES.HYBRID && socketAdapter) {
            status.remote = socketAdapter.events ? 'active' : 'inactive';
        }

        return status;
    }

    return Object.freeze({
        start,
        stop,
        send,
        onReceive,
        onEvent,
        onActor,
        getStatus
    });
}

module.exports = createHybridTransport;
