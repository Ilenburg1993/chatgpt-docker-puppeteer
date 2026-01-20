/* ==========================================================================
   src/server/nerv_adapter/server_nerv_adapter.js
   Subsistema: SERVER — NERV Adapter
   Audit Level: 800 — Critical Decoupling Layer (Singularity Edition)

   Responsabilidade:
   - Adaptar NERV (pub/sub) para o domínio do SERVER (Dashboard/API)
   - Traduzir requisições HTTP/WebSocket para ActionCodes NERV
   - Broadcast eventos NERV para clientes Socket.io conectados
   - Filtrar eventos por permissões (dashboard não vê tudo)
   - Garantir ZERO acoplamento direto com KERNEL ou DRIVER

   Princípios:
   - NÃO importa KERNEL ou DRIVER diretamente
   - NÃO decide lógica de negócio (apenas traduz e roteia)
   - NÃO acessa filesystem diretamente
   - Comunicação 100% via NERV (pub/sub)
========================================================================== */

const { log } = require('../../core/logger');
const { ActionCode, MessageType, ActorRole } = require('../../shared/nerv/constants');

class ServerNERVAdapter {
    /**
     * @param {Object} nerv - Instância do NERV (IPC transport)
     * @param {Object} socketHub - Instância do Socket.io hub (gerenciador de conexões)
     * @param {Object} config - Configuração do sistema
     */
    constructor(nerv, socketHub, config) {
        if (!nerv) {throw new Error('[ServerNERVAdapter] NERV instance required');}
        if (!socketHub) {throw new Error('[ServerNERVAdapter] SocketHub required');}

        this.nerv = nerv;
        this.socketHub = socketHub;
        this.config = config;

        // Estatísticas observacionais
        this.stats = {
            commandsSent: 0,
            eventsBroadcasted: 0,
            clientsConnected: 0
        };

        // Setup de listeners
        this._setupNERVListeners();
        this._setupSocketListeners();

        log('INFO', '[ServerNERVAdapter] Inicializado e conectado ao NERV');
    }

    /**
     * Configura listeners para eventos NERV que devem ser broadcast ao dashboard.
     */
    _setupNERVListeners() {
        this.nerv.onReceive((envelope) => {
            // Filtra apenas EVENTS (COMMANDS são internos, não vão para dashboard)
            if (envelope.messageType !== MessageType.EVENT) {return;}

            // Broadcast evento para clientes Socket.io conectados
            this._broadcastEvent(envelope).catch(err => {
                log('ERROR', `[ServerNERVAdapter] Erro ao broadcast evento: ${err.message}`, envelope.correlationId);
            });
        });

        log('DEBUG', '[ServerNERVAdapter] Listeners NERV configurados para broadcast de eventos');
    }

    /**
     * Configura listeners para comandos vindos do Socket.io (dashboard).
     * Traduz requisições WS/HTTP para comandos NERV.
     */
    _setupSocketListeners() {
        // Listener para comandos do dashboard (ex: pausar engine, cancelar task)
        this.socketHub.on('dashboard:command', (data) => {
            this._handleDashboardCommand(data).catch(err => {
                log('ERROR', `[ServerNERVAdapter] Erro ao processar comando dashboard: ${err.message}`);
            });
        });

        // Listener para requisições de status/health
        this.socketHub.on('dashboard:status_request', (data) => {
            this._handleStatusRequest(data).catch(err => {
                log('ERROR', `[ServerNERVAdapter] Erro ao processar requisição de status: ${err.message}`);
            });
        });

        // Listener para conexões/desconexões de clientes
        this.socketHub.on('client:connected', (clientId) => {
            this.stats.clientsConnected++;
            log('INFO', `[ServerNERVAdapter] Cliente conectado: ${clientId} (total: ${this.stats.clientsConnected})`);
        });

        this.socketHub.on('client:disconnected', (clientId) => {
            this.stats.clientsConnected = Math.max(0, this.stats.clientsConnected - 1);
            log('INFO', `[ServerNERVAdapter] Cliente desconectado: ${clientId} (total: ${this.stats.clientsConnected})`);
        });

        log('DEBUG', '[ServerNERVAdapter] Listeners Socket.io configurados');
    }

    /**
     * Processa comandos vindos do dashboard e traduz para comandos NERV.
     */
    async _handleDashboardCommand(data) {
        const { command, payload, clientId } = data;

        log('DEBUG', `[ServerNERVAdapter] Comando do dashboard: ${command} (cliente: ${clientId})`);

        // Gera correlation ID único para rastreamento
        const correlationId = `dashboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Mapeia comandos dashboard -> ActionCodes NERV
        let actionCode;
        const nervPayload = payload || {};

        switch (command) {
            case 'task:start':
                actionCode = ActionCode.TASK_START;
                break;

            case 'task:cancel':
                actionCode = ActionCode.TASK_CANCEL;
                break;

            case 'driver:abort':
                actionCode = ActionCode.DRIVER_ABORT;
                break;

            case 'engine:pause':
                actionCode = ActionCode.ENGINE_PAUSE;
                break;

            case 'engine:resume':
                actionCode = ActionCode.ENGINE_RESUME;
                break;

            case 'engine:stop':
                actionCode = ActionCode.ENGINE_STOP;
                break;

            case 'browser:reboot':
                actionCode = ActionCode.BROWSER_REBOOT;
                break;

            default:
                log('WARN', `[ServerNERVAdapter] Comando desconhecido do dashboard: ${command}`);

                // Envia resposta de erro ao cliente
                this.socketHub.sendToClient(clientId, 'command:error', {
                    error: 'UNKNOWN_COMMAND',
                    message: `Comando não reconhecido: ${command}`
                });
                return;
        }

        // Emite comando via NERV
        this._emitCommand(actionCode, nervPayload, correlationId);

        // Envia ACK ao cliente
        this.socketHub.sendToClient(clientId, 'command:ack', {
            command,
            correlationId,
            timestamp: new Date().toISOString()
        });

        this.stats.commandsSent++;
    }

    /**
     * Processa requisições de status/health do dashboard.
     */
    async _handleStatusRequest(data) {
        const { requestType, clientId } = data;

        const correlationId = `status-${Date.now()}`;

        switch (requestType) {
            case 'kernel:health':
                this._emitCommand(ActionCode.KERNEL_HEALTH_CHECK, {}, correlationId);
                break;

            case 'driver:health':
                this._emitCommand(ActionCode.DRIVER_HEALTH_CHECK, {}, correlationId);
                break;

            case 'system:stats':
                // Retorna estatísticas do próprio adapter
                this.socketHub.sendToClient(clientId, 'status:response', {
                    requestType,
                    data: this.getStats(),
                    timestamp: new Date().toISOString()
                });
                break;

            default:
                log('WARN', `[ServerNERVAdapter] Requisição de status desconhecida: ${requestType}`);
        }
    }

    /**
     * Broadcast de evento NERV para todos os clientes Socket.io conectados.
     * Filtra eventos sensíveis que não devem ir para o dashboard.
     */
    async _broadcastEvent(envelope) {
        const { actionCode, payload, correlationId, timestamp } = envelope;

        // Filtro de privacidade: alguns eventos são apenas para observação interna
        const PRIVATE_EVENTS = [
            ActionCode.KERNEL_INTERNAL_ERROR,
            ActionCode.SECURITY_VIOLATION
        ];

        if (PRIVATE_EVENTS.includes(actionCode)) {
            log('DEBUG', `[ServerNERVAdapter] Evento privado não broadcast: ${actionCode}`, correlationId);
            return;
        }

        // Traduz ActionCode para evento Socket.io (convenção dashboard)
        const socketEvent = this._translateEventName(actionCode);

        // Broadcast para todos os clientes conectados
        // Socket.io usa emit() para broadcast global, não broadcast()
        if (this.socketHub && typeof this.socketHub.emit === 'function') {
            this.socketHub.emit(socketEvent, {
                actionCode,
                payload,
                correlationId,
                timestamp: timestamp || new Date().toISOString()
            });
        }

        this.stats.eventsBroadcasted++;

        log('DEBUG', `[ServerNERVAdapter] Evento broadcast: ${socketEvent}`, correlationId);
    }

    /**
     * Traduz ActionCode NERV para nome de evento Socket.io.
     * Convenção: action_code -> namespace:event
     */
    _translateEventName(actionCode) {
        // Ex: DRIVER_TASK_STARTED -> driver:task_started
        // Ex: KERNEL_DECISION_MADE -> kernel:decision_made

        const parts = actionCode.toLowerCase().split('_');
        const namespace = parts[0]; // driver, kernel, task, etc
        const event = parts.slice(1).join('_');

        return `${namespace}:${event}`;
    }

    /**
     * Emite um comando via NERV.
     * Wrapper para padronizar emissões do adapter.
     */
    _emitCommand(actionCode, payload, correlationId) {
        this.nerv.emitCommand({
            actor: ActorRole.SERVER,
            actionCode,
            payload,
            correlationId
        });

        log('DEBUG', `[ServerNERVAdapter] Comando emitido: ${actionCode}`, correlationId);
    }

    /**
     * Broadcast helper - wrapper para socketHub.emit (broadcast global).
     * Socket.io usa emit() para broadcast, não broadcast().
     */
    _broadcast(event, data) {
        if (this.socketHub && typeof this.socketHub.emit === 'function') {
            this.socketHub.emit(event, data);
        }
    }

    /**
     * Shutdown gracioso do adapter.
     */
    async shutdown() {
        log('INFO', '[ServerNERVAdapter] Iniciando shutdown');

        // Notifica clientes conectados sobre shutdown
        if (this.socketHub && typeof this.socketHub.emit === 'function') {
            this.socketHub.emit('system:shutdown', {
                message: 'Sistema entrando em shutdown gracioso',
                timestamp: new Date().toISOString()
            });
        }

        // Aguarda 2 segundos para clientes receberem a notificação
        await new Promise(resolve => setTimeout(resolve, 2000));

        log('INFO', '[ServerNERVAdapter] Shutdown concluído');
    }

    /**
     * Retorna estatísticas observacionais do adapter.
     */
    getStats() {
        return {
            ...this.stats,
            nerv: {
                connected: !!this.nerv,
                health: this.nerv.health?.getStatus() || 'UNKNOWN'
            },
            socket: {
                clientsConnected: this.stats.clientsConnected
            }
        };
    }
}

module.exports = ServerNERVAdapter;
