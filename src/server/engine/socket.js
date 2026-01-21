/* ==========================================================================
   src/server/engine/socket.js
   Audit Level: 600 — Sovereign Distribution Hub (IPC 2.0 Singularity)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Singleton do Socket.io. Gerencia o roteamento de Envelopes,
                     validação de identidade, salas de comando e telemetria.
   Sincronizado com: shared/nerv/schemas.js (NERV Protocol 2.0),
                     ipc_client.js V600.
========================================================================== */

const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { log } = require('../../core/logger');
const { validateRobotIdentity, validateIPCEnvelope } = require('../../shared/nerv/schemas');
const { PROTOCOL_VERSION, ActorRole } = require('../../shared/nerv/constants');

/**
 * Instância única do barramento (Singleton).
 */
let ioInstance = null;

/**
 * Registry de Agentes Vivos (In-Memory).
 * Estrutura: robot_id -> { socket_id, identity, last_seen }
 */
const agentRegistry = new Map();

/**
 * Inicializa o barramento de eventos acoplando-o ao motor HTTP.
 * Implementa lógica de reset automático para suporte a testes e reconexões.
 *
 * @param {object} httpServer - Instância ativa do servidor HTTP.
 * @returns {object} A instância do Socket.io configurada.
 */
function init(httpServer) {
    if (ioInstance) {
        log('WARN', '[HUB] Reinicialização detectada. Forçando limpeza da instância anterior...');
        ioInstance.close();
        ioInstance = null;
    }

    log('INFO', '[HUB] Mission Control Hub V600 Online (IPC 2.0 Native).');

    ioInstance = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        transports: ['websocket'],
        pingTimeout: 10000,
        pingInterval: 5000
    });

    ioInstance.on('connection', socket => {
        // 1. FILTRO DE INFRAESTRUTURA (Token de Acesso)
        const token = socket.handshake.auth?.token;
        const isAgentAttempt = token === 'SYSTEM_MAESTRO_PRIME';

        if (isAgentAttempt) {
            log('DEBUG', `[HUB] Tentativa de acoplamento de agente (ID: ${socket.id}).`);
            _setupMaestroProtocol(socket);
        } else {
            // [P8.4] SECURITY: Dashboard authentication (optional but recommended)
            const dashboardPassword = process.env.DASHBOARD_PASSWORD || null;

            if (dashboardPassword) {
                const userPassword = socket.handshake.auth?.password;

                if (userPassword !== dashboardPassword) {
                    log('WARN', `[HUB] Dashboard authentication failed for ${socket.id}`);
                    socket.emit('auth_required', { message: 'Password required for dashboard access' });
                    socket.disconnect(true);
                    return;
                }
                log('DEBUG', `[HUB] Dashboard authenticated: ${socket.id}`);
            }

            // Terminais de visualização (Dashboard) entram na sala de broadcast de telemetria
            socket.join('dashboards');
            log('DEBUG', `[HUB] Terminal Dashboard conectado: ${socket.id}`);
        }

        socket.on('disconnect', reason => {
            if (socket.robot_id) {
                agentRegistry.delete(socket.robot_id);
                log('WARN', `[HUB] Maestro ${socket.robot_id} desconectado. Causa: ${reason}`);

                // Notifica os terminais sobre a queda do agente para atualização de UI
                ioInstance.to('dashboards').emit('hub:agent_offline', { robot_id: socket.robot_id });
            }
        });
    });

    return ioInstance;
}

/**
 * Protocolo de Comunicação Soberana para o Maestro.
 * Implementa Handshake, Promoção de Estado e Roteamento de Envelopes.
 */
function _setupMaestroProtocol(socket) {
    /**
     * Guarda de Handshake: O robô deve se identificar em 5 segundos ou será expulso.
     */
    const handshakeTimeout = setTimeout(() => {
        if (!socket.authorized) {
            log('WARN', `[HUB] Handshake Timeout para ${socket.id}. Encerrando conexão.`);
            socket.emit('handshake:rejected', { reason: 'TIMEOUT' });
            socket.disconnect();
        }
    }, 5000);

    // 1. CERIMÔNIA DE APRESENTAÇÃO (Handshake V2)
    socket.on('handshake:present', data => {
        try {
            // Validação Nativa (Shared Kernel) - Audit 410
            const identity = validateRobotIdentity(data.identity);

            // Verificação de Compatibilidade de Protocolo
            if (identity.version !== PROTOCOL_VERSION) {
                throw new Error(`Protocol Drift: Server ${PROTOCOL_VERSION} vs Agent ${identity.version}`);
            }

            // Homologação e Promoção de Estado do Socket
            clearTimeout(handshakeTimeout);
            socket.authorized = true;
            socket.robot_id = identity.robot_id;
            socket.instance_id = identity.instance_id;

            // Registro no Inventário Global de Agentes
            agentRegistry.set(identity.robot_id, {
                socket_id: socket.id,
                identity,
                last_seen: Date.now()
            });

            // O Maestro entra em salas privadas para comandos direcionados (Unicast)
            socket.join('system_agents');
            socket.join(`agent:${identity.robot_id}`);

            log('INFO', `[HUB] Maestro Homologado: DNA ${identity.robot_id}`);

            // Resposta de Autorização (Handshake ACK)
            socket.emit('handshake:authorized', {
                session_id: socket.id,
                server_ts: Date.now()
            });

            // Notifica Dashboards sobre o novo agente pronto para missões
            ioInstance.to('dashboards').emit('hub:agent_online', identity);
        } catch (err) {
            log('ERROR', `[HUB] Handshake rejeitado para ${socket.id}: ${err.message}`);
            socket.emit('handshake:rejected', { reason: err.message });
            socket.disconnect();
        }
    });

    // 2. RECEPTOR DE MENSAGENS ESTRUTURADAS (Envelope V2)
    socket.on('message', rawEnvelope => {
        if (!socket.authorized) {
            return;
        }

        try {
            // Validação Nativa de Integridade de Envelope
            const envelope = validateIPCEnvelope(rawEnvelope);

            /**
             * ROTEAMENTO DE TELEMETRIA:
             * Toda mensagem vinda do Maestro (Eventos, ACKs, Logs) é retransmitida
             * para os terminais de monitoramento (Dashboards).
             */
            ioInstance.to('dashboards').emit('maestro:telemetry', envelope);

            // Atualiza pulsação de atividade no registry para o Supervisor
            if (agentRegistry.has(socket.robot_id)) {
                agentRegistry.get(socket.robot_id).last_seen = Date.now();
            }
        } catch (err) {
            log('ERROR', `[HUB] Envelope malformado de ${socket.robot_id}: ${err.message}`);
        }
    });
}

/* ==========================================================================
   API DE COMANDO E CONTROLE (SERVER-SIDE)
========================================================================== */

/**
 * Envia um comando estruturado para um robô específico ou para todos.
 *
 * @param {string} command - Constante ActionCode (ex: ENGINE_PAUSE).
 * @param {object} payload - Conteúdo útil do comando.
 * @param {string} [robotId] - ID do robô alvo. Se nulo, envia para todos (Broadcast).
 * @returns {string} O msg_id gerado para rastreamento de ACK.
 */
function sendCommand(command, payload, robotId = null) {
    if (!ioInstance) {
        return null;
    }

    const msgId = uuidv4();
    const correlationId = payload.correlation_id || uuidv4();

    const envelope = {
        header: {
            version: PROTOCOL_VERSION,
            timestamp: Date.now(),
            source: ActorRole.MISSION_CONTROL
        },
        ids: {
            msg_id: msgId,
            correlation_id: correlationId
        },
        kind: command,
        payload
    };

    const target = robotId ? `agent:${robotId}` : 'system_agents';
    ioInstance.to(target).emit('message', envelope);

    log('DEBUG', `[HUB] Comando ${command} enviado para ${target}`, correlationId);
    return msgId;
}

/**
 * Encerramento atômico do Hub.
 * Garante desconexão forçada de todos os agentes e limpeza total de memória.
 * Essencial para o ciclo de vida NASA Standard.
 */
async function stop() {
    if (ioInstance) {
        log('INFO', '[HUB] Encerrando barramento e limpando conexões...');

        // Força a desconexão de todos os clientes ativos (Agentes e Dashboards)
        const sockets = await ioInstance.fetchSockets();
        for (const s of sockets) {
            s.disconnect(true);
        }

        await new Promise(resolve => {
            ioInstance.close(() => {
                ioInstance = null;
                resolve();
            });
        });

        agentRegistry.clear();
        log('INFO', '[HUB] Barramento Socket.io limpo com sucesso.');
    }
}

/**
 * Notify: Broadcast global informativo para todos os conectados.
 */
function notify(event, data) {
    if (!ioInstance) {
        return false;
    }
    ioInstance.emit(event, data);
    return true;
}

module.exports = {
    init,
    sendCommand,
    notify,
    stop,
    getRegistry: () => Array.from(agentRegistry.values()),
    getIO: () => ioInstance
};
