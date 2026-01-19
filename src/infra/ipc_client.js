/* ==========================================================================
   src/infra/ipc_client.js
   Audit Level: 600 — Sovereign Resilient IPC Client (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestrar a comunicação determinística Maestro ↔ Server.
                     Implementa Handshake V2, Outbox Buffering, Correlation 
                     Tracing e Validação Nativa de Fronteira.
   Sincronizado com: schemas.js V410, buffer.js V450, constants.js V400.
========================================================================== */

const { io: socketIOClient } = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { log } = require('../core/logger');
const identityManager = require('../core/identity_manager');

// Shared Kernel e Subsistemas
const IPCBuffer = require('./ipc/buffer'); 
const { IPCConnState, IPCActor, PROTOCOL_VERSION, IPCCommand, IPCEvent } = require('../shared/ipc/constants');
const { validateIPCEnvelope } = require('../shared/ipc/schemas');

const ROOT = path.resolve(__dirname, '../../');
const STATE_FILE = path.join(ROOT, 'estado.json');

class IPCClient {
    constructor() {
        this._initializeState();
    }

    /**
     * Inicializa ou reseta o estado interno do cliente.
     */
    _initializeState() {
        this.socket = null;
        this.state = IPCConnState.DISCONNECTED;
        this.handlers = this.handlers || new Map(); // Preserva handlers entre reconexões
        this.pendingRequests = new Map();
        this.connectionPromise = null;
        
        // [V600] Represa de mensagens para resiliência offline (2000 msgs teto)
        this.outbox = new IPCBuffer(2000); 
    }

    /**
     * Descobre a porta do Mission Control lendo o estado.json.
     */
    _discoverPort(defaultPort = 3000) {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
                if (state.server_port) return state.server_port;
            }
        } catch (err) { 
            log('WARN', `[IPC] Falha na descoberta de porta: ${err.message}`); 
        }
        return defaultPort;
    }

    /**
     * Inicia a conexão e a cerimônia de Handshake.
     * @returns {Promise<void>} Resolve apenas após AUTHORIZED.
     */
    async connect(defaultPort = 3000) {
        if (this.connectionPromise) return this.connectionPromise;
        if (this.isConnected()) return Promise.resolve();

        this.connectionPromise = this._attemptConnection(defaultPort);
        try { 
            await this.connectionPromise; 
        } finally { 
            this.connectionPromise = null; 
        }
    }

    async _attemptConnection(defaultPort) {
        return new Promise((resolve, reject) => {
            const port = this._discoverPort(defaultPort);
            const url = `http://localhost:${port}`;

            log('INFO', `[IPC] Conectando ao barramento em ${url}...`);

            this.socket = socketIOClient(url, {
                auth: { token: 'SYSTEM_MAESTRO_PRIME' },
                transports: ['websocket'],
                reconnection: true,
                reconnectionDelay: 500, // Reconexão agressiva para alta disponibilidade
                forceNew: true,         // Garante isolamento de socket
                timeout: 10000
            });

            // --- CICLO DE VIDA DO TRANSPORTE ---

            this.socket.on('connect', () => {
                this.state = IPCConnState.QUARANTINE;
                log('DEBUG', '[IPC] Transporte físico OK. Iniciando Handshake...');
                this._performHandshake();
            });

            this.socket.on('handshake:authorized', (data) => {
                this.state = IPCConnState.AUTHORIZED;
                log('INFO', `[IPC] Handshake Homologado. Sessão: ${data.session_id}`);
                
                // [V600] REPLAY: Descarrega o buffer acumulado durante o blackout
                this._flushOutbox();
                
                this._emitInternal('connected', data);
                resolve();
            });

            this.socket.on('handshake:rejected', (err) => {
                this.state = IPCConnState.DISCONNECTED;
                log('FATAL', `[IPC] Identidade Rejeitada: ${err.reason}`);
                this.socket.disconnect();
                reject(new Error(`HANDSHAKE_REJECTED: ${err.reason}`));
            });

            this.socket.on('message', (env) => this._handleIncoming(env));
            
            this.socket.on('disconnect', (reason) => {
                this.state = IPCConnState.DISCONNECTED;
                log('WARN', `[IPC] Transporte encerrado: ${reason}`);
                this._emitInternal('disconnect', { reason });
            });

            this.socket.on('error', (err) => {
                log('ERROR', `[IPC] Erro no socket: ${err.message}`);
                this._emitInternal('error', { message: err.message });
            });
        });
    }

    /**
     * Apresenta a Identidade Soberana ao Servidor.
     */
    _performHandshake() {
        this.state = IPCConnState.HANDSHAKING;
        const identity = identityManager.getFullIdentity();
        this.socket.emit('handshake:present', {
            identity,
            timestamp: Date.now(),
            version: PROTOCOL_VERSION
        });
    }

    /**
     * Gerencia a recepção de envelopes, validação e despacho.
     */
    _handleIncoming(rawEnvelope) {
        try {
            // [V600] Validação Nativa (Shared Kernel)
            const envelope = validateIPCEnvelope(rawEnvelope);

            if (this.state !== IPCConnState.AUTHORIZED) return;
            
            // Resolução de ACKs pendentes
            if (envelope.ack_for && this.pendingRequests.has(envelope.ack_for)) {
                const pending = this.pendingRequests.get(envelope.ack_for);
                clearTimeout(pending.timeout);
                pending.resolve(envelope.payload);
                this.pendingRequests.delete(envelope.ack_for);
                return;
            }

            const isCommand = Object.values(IPCCommand).includes(envelope.kind);
            if (isCommand) {
                this._processCommand(envelope);
            } else {
                this._emitInternal(envelope.kind, envelope.payload, envelope.ids.correlation_id);
            }
        } catch (err) { 
            log('ERROR', `[IPC] Envelope inválido ignorado: ${err.message}`); 
        }
    }

    /**
     * Processa um comando e devolve o ACK técnico obrigatório.
     */
    async _processCommand(envelope) {
        const { msg_id, correlation_id } = envelope.ids;
        try {
            // Executa handlers registrados (ex: pause, resume)
            await this._emitInternal(envelope.kind, envelope.payload, correlation_id);
            this.sendAck(msg_id, correlation_id, { status: 'ACCEPTED' });
        } catch (err) {
            this.sendAck(msg_id, correlation_id, { status: 'REJECTED', error: err.message });
        }
    }

    /* ==========================================================================
       API DE MENSAGERIA (COM RESILIÊNCIA OFFLINE)
    ========================================================================== */

    /**
     * Envia um evento ou o bufferiza se o transporte estiver offline.
     */
    emitEvent(kind, payload, correlationId = uuidv4()) {
        const envelope = this._buildEnvelope(kind, payload, correlationId);

        if (this.isConnected()) {
            this.socket.emit('message', envelope);
            return true;
        } else {
            // [V600] Persistência em RAM durante o blackout
            this.outbox.enqueue(envelope);
            log('DEBUG', `[IPC] Offline. Mensagem bufferizada: ${kind}`);
            return false;
        }
    }

    /**
     * Descarrega a represa de mensagens.
     */
    _flushOutbox() {
        if (this.outbox.isEmpty()) return;
        const messages = this.outbox.flush();
        messages.forEach(env => this.socket.emit('message', env));
    }

    /**
     * Envia confirmação técnica (ACK) para uma mensagem.
     */
    sendAck(targetMsgId, correlationId, payload) {
        const envelope = this._buildEnvelope(IPCEvent.AGENT_READY, payload, correlationId);
        envelope.ack_for = targetMsgId;
        if (this.isConnected()) this.socket.emit('message', envelope);
    }

    /**
     * Helper: Construtor de Envelopes V2.
     */
    _buildEnvelope(kind, payload, correlationId) {
        return {
            header: { 
                version: PROTOCOL_VERSION, 
                timestamp: Date.now(), 
                source: IPCActor.MAESTRO 
            },
            ids: { 
                msg_id: uuidv4(), 
                correlation_id: correlationId 
            },
            kind, 
            payload
        };
    }

    /* ==========================================================================
       EVENT DISPATCHER (INTERNAL)
    ========================================================================== */

    on(event, callback) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(callback);
    }

    async _emitInternal(event, payload, correlationId) {
        if (this.handlers.has(event)) {
            const promises = [];
            this.handlers.get(event).forEach(cb => 
                promises.push(Promise.resolve(cb(payload, correlationId)))
            );
            return Promise.all(promises);
        }
    }

    isConnected() { 
        return this.state === IPCConnState.AUTHORIZED; 
    }

    /**
     * Encerramento limpo da conexão.
     */
    async disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.state = IPCConnState.DISCONNECTED;
        log('INFO', '[IPC] Transporte encerrado manualmente.');
    }

    /**
     * Destruição total para limpeza de memória (Audit Level 600).
     */
    async destroy() {
        await this.disconnect();
        this._initializeState();
        log('INFO', '[IPC] Cliente resetado e memória liberada.');
    }
}

// Exporta Singleton Soberano
module.exports = new IPCClient();