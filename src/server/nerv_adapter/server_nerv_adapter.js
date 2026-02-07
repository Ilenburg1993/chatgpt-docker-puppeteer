// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import { ActionCode, MessageType, ActorRole } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';

/* ==========================================================================
   CONSTANTES DE SEGURANÇA
========================================================================== */

/**
 * Eventos NERV que NÃO devem ser expostos ao dashboard.
 * Política: proteção de segurança e ruído interno.
 */
const PRIVATE_EVENTS = new Set([
    ActionCode.KERNEL_INTERNAL_ERROR,
    ActionCode.SECURITY_VIOLATION
]);

/**
 * Tempo máximo de espera para broadcast de shutdown.
 * Evita bloqueio excessivo no encerramento coordenado.
 */
const SHUTDOWN_BROADCAST_DELAY_MS = 1500;


/* ==========================================================================
   CLASSE ADAPTER
========================================================================== */

class ServerNERVAdapter {

    /**
     * @param {Object} nerv      Instância NERV (obrigatória)
     * @param {Object} socketHub Hub Socket (obrigatório — wrapper, não raw io)
     * @param {Object} config    Configuração do sistema
     */
    constructor(nerv, socketHub, config) {

        /* ---------------- validações de contrato ---------------- */

        if (!nerv) {
            throw new Error('[ServerNERVAdapter] NERV instance required');
        }

        if (!socketHub) {
            throw new Error('[ServerNERVAdapter] socketHub required');
        }

        if (typeof socketHub.emit !== 'function') {
            throw new Error('[ServerNERVAdapter] socketHub.emit required');
        }

        if (typeof socketHub.on !== 'function') {
            throw new Error('[ServerNERVAdapter] socketHub.on required');
        }

        if (typeof socketHub.sendToClient !== 'function') {
            throw new Error('[ServerNERVAdapter] socketHub.sendToClient required');
        }

        /* ---------------- estado interno ---------------- */

        this.nerv = nerv;
        this.socketHub = socketHub;
        this.config = config;

        this._shutdown = false;

        /**
         * Estatísticas observacionais — não funcionais.
         * Não influenciam lógica.
         */
        this.stats = {
            commandsSent: 0,
            eventsBroadcasted: 0,
            clientsConnected: 0
        };

        /**
         * Handlers registrados — necessários para cleanup.
         */
        this._handlers = {
            nervReceive: null,
            dashboardCommand: null,
            dashboardStatus: null,
            clientConnected: null,
            clientDisconnected: null
        };

        /* ---------------- bootstrap de listeners ---------------- */

        this._setupNERVListeners();
        this._setupSocketListeners();

        log('INFO', '[ServerNERVAdapter] Inicializado — bridge NERV ↔ Socket ativa');
    }


/* ==========================================================================
   LISTENERS — NERV → DASHBOARD
========================================================================== */

    /**
     * Registra listener NERV → broadcast dashboard.
     * Apenas EVENT é propagado.
     */
    _setupNERVListeners() {

        this._handlers.nervReceive = envelope => {

            if (this._shutdown) return;

            if (envelope.messageType !== MessageType.EVENT) return;

            this._broadcastEvent(envelope)
                .catch(err => {
                    log('ERROR',
                        `[ServerNERVAdapter] broadcast falhou: ${err.message}`,
                        envelope.correlationId
                    );
                });
        };

        this.nerv.onReceive(this._handlers.nervReceive);

        log('DEBUG', '[ServerNERVAdapter] Listener NERV registrado');
    }


/* ==========================================================================
   LISTENERS — DASHBOARD → NERV
========================================================================== */

    /**
     * Registra listeners Socket → comandos dashboard.
     */
    _setupSocketListeners() {

        this._handlers.dashboardCommand = data => {
            this._handleDashboardCommand(data)
                .catch(err => {
                    log('ERROR', `[ServerNERVAdapter] comando dashboard falhou: ${err.message}`);
                });
        };

        this._handlers.dashboardStatus = data => {
            this._handleStatusRequest(data)
                .catch(err => {
                    log('ERROR', `[ServerNERVAdapter] status request falhou: ${err.message}`);
                });
        };

        this._handlers.clientConnected = clientId => {
            this.stats.clientsConnected++;
            log('INFO', `[ServerNERVAdapter] Cliente conectado: ${clientId}`);
        };

        this._handlers.clientDisconnected = clientId => {
            this.stats.clientsConnected = Math.max(0, this.stats.clientsConnected - 1);
            log('INFO', `[ServerNERVAdapter] Cliente desconectado: ${clientId}`);
        };

        this.socketHub.on('dashboard:command', this._handlers.dashboardCommand);
        this.socketHub.on('dashboard:status_request', this._handlers.dashboardStatus);
        this.socketHub.on('client:connected', this._handlers.clientConnected);
        this.socketHub.on('client:disconnected', this._handlers.clientDisconnected);

        log('DEBUG', '[ServerNERVAdapter] Listeners Socket registrados');
    }


/* ==========================================================================
   DASHBOARD COMMAND HANDLER
========================================================================== */

    /**
     * Traduz comando dashboard → ActionCode NERV.
     */
    async _handleDashboardCommand(data = {}) {

        const { command, payload, clientId } = data;

        if (!command) return;

        const correlationId =
            `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        let actionCode;

        switch (command) {
            case 'task:start':     actionCode = ActionCode.TASK_START; break;
            case 'task:cancel':    actionCode = ActionCode.TASK_CANCEL; break;
            case 'driver:abort':   actionCode = ActionCode.DRIVER_ABORT; break;
            case 'engine:pause':   actionCode = ActionCode.ENGINE_PAUSE; break;
            case 'engine:resume':  actionCode = ActionCode.ENGINE_RESUME; break;
            case 'engine:stop':    actionCode = ActionCode.ENGINE_STOP; break;
            case 'browser:reboot': actionCode = ActionCode.BROWSER_REBOOT; break;

            default:
                this.socketHub.sendToClient(clientId, 'command:error', {
                    error: 'UNKNOWN_COMMAND',
                    command
                });
                return;
        }

        /* ----- ponto de extensão: validação de schema ----- */
        const nervPayload = payload || {};

        this._emitCommand(actionCode, nervPayload, correlationId);

        this.socketHub.sendToClient(clientId, 'command:ack', {
            command,
            correlationId,
            timestamp: new Date().toISOString()
        });

        this.stats.commandsSent++;
    }


/* ==========================================================================
   STATUS REQUEST HANDLER
========================================================================== */

    async _handleStatusRequest(data = {}) {

        const { requestType, clientId } = data;
        const correlationId = `status-${Date.now()}`;

        if (requestType === 'system:stats') {
            this.socketHub.sendToClient(clientId, 'status:response', {
                data: this.getStats()
            });
            return;
        }

        if (requestType === 'kernel:health') {
            this._emitCommand(ActionCode.KERNEL_HEALTH_CHECK, {}, correlationId);
        }

        if (requestType === 'driver:health') {
            this._emitCommand(ActionCode.DRIVER_HEALTH_CHECK, {}, correlationId);
        }
    }


/* ==========================================================================
   EVENT BROADCAST
========================================================================== */

    async _broadcastEvent(envelope) {

        if (PRIVATE_EVENTS.has(envelope.actionCode)) return;

        const socketEvent = this._translateEventName(envelope.actionCode);

        this.socketHub.emit(socketEvent, {
            actionCode: envelope.actionCode,
            payload: envelope.payload,
            correlationId: envelope.correlationId,
            timestamp: envelope.timestamp || new Date().toISOString()
        });

        this.stats.eventsBroadcasted++;
    }


/* ==========================================================================
   UTILITIES
========================================================================== */

    _translateEventName(actionCode) {
        const p = actionCode.toLowerCase().split('_');
        return `${p[0]}:${p.slice(1).join('_')}`;
    }

    _emitCommand(actionCode, payload, correlationId) {
        try {
            HighLevelNERV.sendCommand(this.nerv, ActorRole.SERVER, actionCode, payload, correlationId);
        } catch (err) {
            log('ERROR', `[ServerNERVAdapter] Falha ao emitir comando: ${err.message}`, correlationId);
        }
    }


/* ==========================================================================
   SHUTDOWN
========================================================================== */

    async shutdown() {

        if (this._shutdown) return;
        this._shutdown = true;

        log('INFO', '[ServerNERVAdapter] Shutdown iniciado');

        /* ---- remove listeners ---- */

        try {
            if (this._handlers.nervReceive && this.nerv.offReceive) {
                this.nerv.offReceive(this._handlers.nervReceive);
            }
        } catch (err) {
            log(
                'WARN',
                `[ServerNERVAdapter] Falha ao remover nervReceive listener: ${err && err.message ? err.message : String(err)}`
            );
        }

        if (this.socketHub.off) {
            this.socketHub.off('dashboard:command', this._handlers.dashboardCommand);
            this.socketHub.off('dashboard:status_request', this._handlers.dashboardStatus);
            this.socketHub.off('client:connected', this._handlers.clientConnected);
            this.socketHub.off('client:disconnected', this._handlers.clientDisconnected);
        }

        /* ---- notifica clientes ---- */

        this.socketHub.emit('system:shutdown', {
            message: 'Shutdown gracioso em andamento'
        });

        await new Promise(r => setTimeout(r, SHUTDOWN_BROADCAST_DELAY_MS));

        log('INFO', '[ServerNERVAdapter] Shutdown concluído');
    }


/* ==========================================================================
   OBSERVABILIDADE
========================================================================== */

    getStats() {
        return {
            ...this.stats,
            nervConnected: !!this.nerv
        };
    }
}

export default ServerNERVAdapter;
