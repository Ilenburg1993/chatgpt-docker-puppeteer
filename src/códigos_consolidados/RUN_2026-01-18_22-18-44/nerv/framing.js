FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\framing.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/core.js
   Audit Level: 580 — NERV Core Logic (Neural Hub)
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: 
     - Orquestrar o ciclo de vida da conexão (State Machine).
     - Gerenciar a Fila de Saída (Outbox) com Backpressure.
     - Executar o Protocolo de Handshake.
     - Garantir a entrega ordenada de envelopes.
========================================================================== */

const EventEmitter = require('events');
const createBackpressure = require('./buffers/backpressure');
const framing = require('./framing');

// Importações Constitucionais (Shared Kernel)
const { 
    ChannelState, 
    MessageType, 
    ActionCode, 
    ActorRole,
    TechnicalCode 
} = require('../shared/ipc/constants');

const { validateIPCEnvelope, validateRobotIdentity } = require('../shared/ipc/schemas');
const { createEnvelope } = require('../shared/ipc/envelope');

/**
 * Fábrica do Sistema Nervoso (NERV).
 * * @param {object} deps
 * @param {object} deps.io - Instância de IO para persistência local (opcional/future).
 * @param {object} deps.connection - O Adaptador de Transporte (SocketIOAdapter).
 * @param {object} deps.identity - A Identidade Soberana do Robô.
 */
function createNerv({ connection, identity }) {
    // 1. Bus de Eventos Interno (Telemetria)
    const telemetry = new EventEmitter();

    // 2. Estado Interno
    let state = ChannelState.DISCONNECTED;
    const outbox = []; // Fila de saída em memória

    // 3. Subsistemas
    const pressure = createBackpressure({ telemetry });

    /* =========================================================
       MAQUINA DE ESTADOS (STATE MACHINE)
    ========================================================= */
    
    function setState(newState) {
        if (state !== newState) {
            const oldState = state;
            state = newState;
            telemetry.emit('nerv:state:change', { from: oldState, to: newState });
            
            // Se o canal abrir (READY), tenta drenar a fila
            if (state === ChannelState.READY) {
                flushOutbox();
            }
        }
    }

    /* =========================================================
       PROTOCOL HANDLERS (HANDSHAKE)
    ========================================================= */

    /**
     * Inicia a cerimônia de apresentação.
     * Envia a identidade do robô para o servidor.
     */
    function performHandshake() {
        setState(ChannelState.HANDSHAKE);

        const handshakeEnvelope = createEnvelope({
            actor: ActorRole.MAESTRO,
            target: ActorRole.SERVER,
            messageType: MessageType.COMMAND,
            actionCode: ActionCode.HANDSHAKE,
            payload: identity // { robot_id, capabilities... }
        });

        // Envia furando a fila (Prioridade Máxima)
        sendPhysical(handshakeEnvelope);
    }

    /**
     * Processa a resposta do Handshake.
     */
    function handleHandshakeResponse(envelope) {
        if (envelope.type.kind === MessageType.ACK && envelope.type.action === ActionCode.HANDSHAKE) {
            telemetry.emit('nerv:log', { level: 'INFO', msg: 'Handshake aceito pelo Servidor.' });
            setState(ChannelState.READY);
        } else {
            telemetry.emit('nerv:error', { 
                code: TechnicalCode.HANDSHAKE_FAILED,
                msg: 'Servidor recusou handshake ou resposta inválida.' 
            });
            disconnect(); // Aborta conexão
        }
    }

    /* =========================================================
       CORE LOGIC (SEND/RECEIVE)
    ========================================================= */

    /**
     * Envio Físico Imediato (Bypassing Queue).
     * Uso interno apenas.
     */
    function sendPhysical(envelope) {
        try {
            const frame = framing.pack(envelope);
            connection.send(frame);
        } catch (err) {
            telemetry.emit('nerv:error', { msg: `Falha no envio físico: ${err.message}` });
        }
    }

    /**
     * Processa a fila de saída.
     */
    function flushOutbox() {
        if (state !== ChannelState.READY) return;

        while (outbox.length > 0) {
            const envelope = outbox.shift();
            sendPhysical(envelope);
            
            // Atualiza sensor de pressão
            pressure.update(outbox.length);
        }
    }

    /**
     * Interface Pública de Envio.
     * Coloca na fila e gerencia Backpressure.
     */
    function send(envelope) {
        // Validação de Saída (Self-Check)
        try {
            validateIPCEnvelope(envelope);
        } catch (err) {
            telemetry.emit('nerv:error', { msg: `Tentativa de envio de envelope inválido: ${err.message}` });
            return;
        }

        // Enfileiramento
        outbox.push(envelope);
        pressure.update(outbox.length);

        // Tenta enviar se possível
        if (state === ChannelState.READY) {
            flushOutbox();
        }
    }

    /**
     * Handler de Recebimento (Inbound Pipeline).
     */
    function onIncomingData(rawFrame) {
        // 1. Unpacking
        const envelope = framing.unpack(rawFrame);
        if (!envelope) {
            telemetry.emit('nerv:dropped', { reason: 'MALFORMED_FRAME' });
            return;
        }

        // 2. Validação Constitucional (Schema)
        try {
            validateIPCEnvelope(envelope);
        } catch (err) {
            telemetry.emit('nerv:dropped', { reason: 'INVALID_SCHEMA', details: err.message });
            // TODO: Enviar NACK para o servidor? (Opcional)
            return;
        }

        // 3. Roteamento de Protocolo
        // Se estamos em handshake, intercepta a resposta
        if (state === ChannelState.HANDSHAKE) {
            handleHandshakeResponse(envelope);
            return;
        }

        // 4. Entrega ao Kernel (Consumidor Final)
        // Só entrega se estivermos READY (ou se for comando de controle crítico)
        if (state === ChannelState.READY) {
            telemetry.emit('nerv:inbound', envelope);
        } else {
            telemetry.emit('nerv:dropped', { reason: 'CHANNEL_NOT_READY' });
        }
    }

    /* =========================================================
       LIFECYCLE BINDING
    ========================================================= */

    function connect() {
        if (state !== ChannelState.DISCONNECTED) return;
        
        setState(ChannelState.CONNECTING);
        
        // Liga os ouvidos ao adaptador físico
        connection.onReceive(onIncomingData);
        
        // Inicia conexão física
        connection.start();
    }

    function disconnect() {
        connection.stop();
        setState(ChannelState.DISCONNECTED);
    }

    // Escuta eventos do adaptador físico para transições de estado
    // O adaptador deve emitir 'connect' e 'disconnect'
    if (connection.events) {
        connection.events.on('connect', () => {
            // Conexão física estabelecida -> Iniciar Handshake Lógico
            performHandshake();
        });

        connection.events.on('disconnect', () => {
            setState(ChannelState.DISCONNECTED);
        });
        
        connection.events.on('error', (err) => {
            telemetry.emit('nerv:error', err);
        });
    }

    return {
        connect,
        disconnect,
        send,
        telemetry, // Exposta para o Kernel ouvir
        pressure,
        // Getters de Estado
        getState: () => state,
        getOutboxSize: () => outbox.length
    };
}

module.exports = createNerv;