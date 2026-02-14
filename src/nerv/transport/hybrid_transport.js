// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { CONNECTION_MODES } from '#core/constants/browser';
import { getActionCode, getCorrelationId, getMessageType, getMsgId } from '#shared/nerv/envelope_reader';
import EventEmitter from 'node:events';

/**
 * Estados do Circuit Breaker
 */
const CIRCUIT_STATES = {
    CLOSED: 'CLOSED',     // Funcionando normalmente
    OPEN: 'OPEN',         // Falhando, só local
    HALF_OPEN: 'HALF_OPEN' // Testando recuperação
};

/**
 * Cria transporte híbrido com suporte local + remoto + circuit breaker.
 *
 * **Side-effects:** Inicializa EventEmitter local, conecta Socket.io se híbrido.
 * **Semântica:** Abstração unificada de transporte local/remoto via NERV com resiliência.
 * **Unidades:** mode segue CONNECTION_MODES, handlerId como contador incremental.
 *
 * @param {object} config - Configuração do transporte híbrido
 * @param {string} [config.mode='LOCAL'] - Modo de conexão ('LOCAL'|'HYBRID')
 * @param {object} [config.socketAdapter=null] - Adapter Socket.io para modo híbrido
 * @param {object} config.telemetry - Interface de telemetria NERV
 * @returns {object} Transporte híbrido com métodos send, onReceive, start, stop
 * @throws {Error} Se telemetry não for fornecida
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

    // Circuit Breaker State
    let circuitState = CIRCUIT_STATES.CLOSED;
    let failureCount = 0;
    let _lastFailureTime = 0;
    let nextAttemptTime = 0;

    // Circuit Breaker Configuration
    const FAILURE_THRESHOLD = 5;    // Falhas consecutivas para abrir
    const TIMEOUT_MS = 60000;       // 1 minuto para tentar recuperação

    /**
     * Atualiza estado do circuit breaker baseado em sucesso/falha.
     */
    function updateCircuitBreaker(success) {
        const now = Date.now();

        if (success) {
            failureCount = 0;
            circuitState = CIRCUIT_STATES.CLOSED;
            telemetry.emit('circuit_breaker_success', { state: circuitState });
        } else {
            failureCount++;
            _lastFailureTime = now;

            if (failureCount >= FAILURE_THRESHOLD) {
                circuitState = CIRCUIT_STATES.OPEN;
                nextAttemptTime = now + TIMEOUT_MS;
                telemetry.emit('circuit_breaker_open', {
                    state: circuitState,
                    failureCount,
                    nextAttemptTime
                });
            }
        }
    }

    /**
     * Verifica se deve tentar conexão remota (circuit breaker logic).
     */
    function shouldAttemptRemote() {
        const now = Date.now();

        if (circuitState === CIRCUIT_STATES.CLOSED) {
            return true;
        }

        if (circuitState === CIRCUIT_STATES.OPEN) {
            if (now >= nextAttemptTime) {
                circuitState = CIRCUIT_STATES.HALF_OPEN;
                telemetry.emit('circuit_breaker_half_open', { state: circuitState });
                return true;
            }
            return false;
        }

        // HALF_OPEN: permite uma tentativa
        return true;
    }

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
                                error: err.message,
                                correlationId: envelope.causality?.correlation_id,
                                msgId: envelope.causality?.msg_id,
                                actionCode: envelope.type?.action_code,
                            });
                        }
                    });
                } catch (err) {
                    telemetry.emit('hybrid_transport_parse_error', {
                        error: err.message,
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
     * Envia mensagem (local via EventEmitter, remoto via Socket.io com circuit breaker).
     *
     * @param {Object} envelope - Envelope NERV normalizado
     */
    function send(envelope) {
        // 1. SEMPRE emite local (fast-path para mesmos processo)
        localBus.emit('message', envelope);

        // 2. Se híbrido, também envia via Socket.io (com circuit breaker)
        if (mode === CONNECTION_MODES.HYBRID && socketAdapter) {
            if (shouldAttemptRemote()) {
                try {
                    const frame = JSON.stringify(envelope);
                    socketAdapter.send(frame);
                    updateCircuitBreaker(true); // Sucesso na tentativa
                } catch (err) {
                    telemetry.emit('hybrid_transport_send_error', {
                        error: err.message,
                        correlationId: envelope.causality?.correlation_id,
                        msgId: envelope.causality?.msg_id,
                        actionCode: envelope.type?.action_code,
                    });
                    updateCircuitBreaker(false); // Falha na tentativa
                }
            } else {
                telemetry.emit('hybrid_transport_skipped', {
                    reason: 'circuit_breaker_open',
                    state: circuitState,
                    correlationId: envelope.causality?.correlation_id,
                });
            }
        }

        // Telemetria de envio bem-sucedido
        telemetry.emit('hybrid_transport_sent', {
            actor: envelope?.identity?.actor || envelope?.actor || envelope?.header?.source || null,
            actionCode: getActionCode(envelope),
            msgId: getMsgId(envelope),
            correlationId: getCorrelationId(envelope),
            messageType: getMessageType(envelope),
            mode: mode === CONNECTION_MODES.HYBRID ? 'local+remote' : CONNECTION_MODES.LOCAL,
        });
    }

    /**
     * Registra handler para receber mensagens.
     *
     * @param {(envelope: any) => void} handler - (envelope) => void
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
     * @param {(envelope: any) => void} handler - (envelope) => void
     * @returns {Function} Unsubscribe function
     */
    function onEvent(actionCode, handler) {
        if (typeof actionCode !== 'string' || !actionCode.trim()) {
            throw new Error('onEvent requer actionCode string');
        }
        if (typeof handler !== 'function') {
            throw new Error('onEvent requer função');
        }

        const wrappedHandler = envelope => {
            if (getMessageType(envelope) !== 'EVENT') return;
            if (getActionCode(envelope) === actionCode) {
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
            const a = envelope?.identity?.actor || envelope?.actor || envelope?.header?.source || null;
            if (a === actor) {
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
            handlers: handlers.size,
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
        getStatus,
    });
}

export default createHybridTransport;
