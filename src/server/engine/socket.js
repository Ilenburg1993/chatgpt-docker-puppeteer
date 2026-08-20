// @ts-check
/** @import {VerifyOptions} from 'jsonwebtoken' */
import CONFIG from '#core/config';
import { getJwtSecret, JWT_VERIFY_OPTIONS } from '#core/jwt_config';
import { log } from '#core/logger';
import { RBAC_PERMISSIONS } from '#infra/db/rbac_repo';
import { isTokenRevoked } from '#infra/db/token_blocklist';
import { hasPermission } from '#server/domain/rbac_policy';
import { ActorRole, PROTOCOL_VERSION } from '#shared/nerv/constants';
import { validateIPCEnvelope, validateRobotIdentity } from '#shared/nerv/schemas';
import jwt from 'jsonwebtoken';
import EventEmitter from 'node:events';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

/**
 * Instância única do barramento (Singleton).
 */
/** @type {any} */
let ioInstance = null;

/* ==========================================================================
   CORS (Dashboard) — Política conservadora
========================================================================== */

let dashboardAllowedOrigins = new Set();
/** @type {any} */
let configUpdatedHandler = null;

function parseBooleanEnv(/** @type {any} */ name, /** @type {any} */ defaultValue) {
    const raw = process.env[name];
    if (raw === undefined) {
        return defaultValue;
    }
    const value = String(raw).trim().toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
    return defaultValue;
}

function getDashboardSocketPolicy() {
    return {
        authRequired: parseBooleanEnv('DASHBOARD_SOCKET_AUTH_REQUIRED', true),
        commandsEnabled: parseBooleanEnv('DASHBOARD_COMMANDS_ENABLED', false),
        commandRole: String(process.env['DASHBOARD_COMMAND_ROLE'] || 'admin').trim() || 'admin',
        emitTaskUpdatedCompat: parseBooleanEnv('DASHBOARD_EMIT_TASK_UPDATED_COMPAT', false),
    };
}

function normalizeOrigins(/** @type {any} */ originsLike) {
    if (Array.isArray(originsLike)) {
        return originsLike.map((origin) => String(origin).trim()).filter(Boolean);
    }

    if (typeof originsLike === 'string') {
        return originsLike
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);
    }

    return [];
}

function refreshAllowedOrigins() {
    const defaults = ['http://localhost:3008', 'http://127.0.0.1:3008', process.env['DASHBOARD_ORIGIN']].filter(
        Boolean,
    );
    const merged = new Set([...defaults, ...normalizeOrigins(CONFIG.ALLOWED_ORIGINS)]);
    dashboardAllowedOrigins = merged;
}

function ensureConfigUpdatedListener() {
    if (configUpdatedHandler) {
        return;
    }

    configUpdatedHandler = () => {
        refreshAllowedOrigins();
        log('INFO', `[HUB] Socket CORS allowlist atualizada (${dashboardAllowedOrigins.size} origens)`);
    };

    if (typeof (/** @type {any} */ (CONFIG).on) === 'function') {
        /** @type {any} */ (CONFIG).on('updated', configUpdatedHandler);
    }
}

function removeConfigUpdatedListener() {
    if (!configUpdatedHandler) {
        return;
    }
    if (typeof (/** @type {any} */ (CONFIG).off) === 'function') {
        /** @type {any} */ (CONFIG).off('updated', configUpdatedHandler);
    }
    configUpdatedHandler = null;
}

function isDashboardOriginAllowed(/** @type {any} */ origin) {
    if (!origin) return true;
    if (dashboardAllowedOrigins.has(origin)) {
        return true;
    }
    log('WARN', `[CORS] Blocked origin: ${origin}`);
    return false;
}

function verifyDashboardToken(/** @type {any} */ token) {
    if (!token || typeof token !== 'string') {
        return { ok: false, code: 'AUTH_TOKEN_MISSING', message: 'Token JWT ausente no handshake' };
    }

    try {
        const decoded = /** @type {any} */ (
            jwt.verify(token, getJwtSecret(), /** @type {VerifyOptions} */ (JWT_VERIFY_OPTIONS))
        );
        const jti = decoded?.jti;

        if (jti && isTokenRevoked(jti)) {
            return { ok: false, code: 'TOKEN_REVOKED', message: 'Token revogado' };
        }

        return {
            ok: true,
            user: {
                id: /** @type {any} */ (decoded).id,
                username: /** @type {any} */ (decoded).username,
                role: /** @type {any} */ (decoded).role || 'viewer',
                roles: Array.isArray(/** @type {any} */ (decoded).roles)
                    ? /** @type {any} */ (decoded).roles.map((/** @type {any} */ r) => String(r))
                    : [],
                permissions: Array.isArray(/** @type {any} */ (decoded).permissions)
                    ? /** @type {any} */ (decoded).permissions.map((/** @type {any} */ p) => String(p))
                    : [],
                jti: /** @type {any} */ (decoded).jti || null,
                exp: /** @type {any} */ (decoded).exp || null,
            },
        };
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return {
            ok: false,
            code: _e?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
            message: _e?.message || 'Token inválido',
        };
    }
}

/**
 * Internal EventEmitter for bridging Socket.io events to other parts of the system. Allows ServerNERVAdapter and other
 * components to listen to dashboard events.
 */
const internalEmitter = new EventEmitter();

/**
 * Registry de Agentes Vivos (In-Memory). Estrutura: robot_id -> { socket_id, identity, last_seen }
 */
const agentRegistry = new Map();

/**
 * P9.8: Debounce buffer para task updates (50ms window) Estrutura: taskId -> { data, timestamp }
 */
const taskUpdateBuffer = new Map();
/** @type {any} */
let taskUpdateTimer = null;

/**
 * P9.8: Flush accumulated task updates to dashboards
 */
function flushTaskUpdates() {
    if (taskUpdateBuffer.size === 0) {
        return;
    }

    const updates = Array.from(taskUpdateBuffer.values()).map((entry) => ({
        taskId: entry.taskId,
        state: entry.state,
    }));

    if (ioInstance) {
        ioInstance.to('dashboards').emit('task:updates_batch', { updates, count: updates.length });
        // Compatibilidade opt-in para consumers legados.
        if (getDashboardSocketPolicy().emitTaskUpdatedCompat) {
            for (const update of updates) {
                ioInstance.to('dashboards').emit('task:updated', update);
            }
        }
        log('DEBUG', `[HUB] Flushed ${updates.length} batched task updates`);
    }

    taskUpdateBuffer.clear();
    taskUpdateTimer = null;
}

/**
 * @typedef {object} InitHttpServer
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Inicializa o barramento de eventos acoplando-o ao motor HTTP. Implementa lógica de reset automático para suporte a
 * testes e reconexões.
 *
 * @param {InitHttpServer} httpServer - Instância ativa do servidor HTTP.
 * @returns {any} A instância do Socket.io configurada.
 */
function init(httpServer) {
    if (ioInstance) {
        log('WARN', '[HUB] Reinicialização detectada. Forçando limpeza da instância anterior...');
        ioInstance.close();
        ioInstance = null;
    }

    refreshAllowedOrigins();
    ensureConfigUpdatedListener();

    log('INFO', '[HUB] Mission Control Hub V600 Online (IPC 2.0 Native).');

    ioInstance = new Server(/** @type {any} */ (httpServer), {
        cors: {
            origin(origin, callback) {
                if (isDashboardOriginAllowed(origin)) {
                    return /** @type {any} */ (callback)(null, true);
                }
                return /** @type {any} */ (callback)(new Error(`Socket CORS blocked for origin: ${origin}`), false);
            },
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket'],
        pingTimeout: 10000,
        pingInterval: 5000,
    });

    ioInstance.on('connection', (/** @type {any} */ socket) => {
        // 1. FILTRO DE INFRAESTRUTURA (Token de Acesso)
        const token = socket.handshake.auth?.token;
        const isAgentAttempt = token === 'SYSTEM_MAESTRO_PRIME';
        const dashboardPolicy = getDashboardSocketPolicy();

        if (isAgentAttempt) {
            log('DEBUG', `[HUB] Tentativa de acoplamento de agente (ID: ${socket.id}).`);
            _setupMaestroProtocol(socket);
        } else {
            if (dashboardPolicy.authRequired) {
                const authResult = verifyDashboardToken(token);
                if (!authResult.ok) {
                    socket.emit('dashboard:auth:error', {
                        code: authResult.code || 'TOKEN_INVALID',
                        error: authResult.message || 'Falha de autenticação',
                    });
                    socket.disconnect(true);
                    return;
                }
                socket.dashboardUser = authResult.user || null;
            } else {
                socket.dashboardUser = null;
            }

            // Terminais de visualização (Dashboard) entram na sala de broadcast de telemetria
            socket.join('dashboards');
            log('DEBUG', `[HUB] Terminal Dashboard conectado: ${socket.id}`);

            // Emit internal event for ServerNERVAdapter
            internalEmitter.emit('client:connected', socket.id);

            // Setup dashboard command listeners
            socket.on('dashboard:command', (/** @type {any} */ data) => {
                const policy = getDashboardSocketPolicy();
                if (!policy.commandsEnabled) {
                    socket.emit('dashboard:command:error', {
                        code: 'COMMAND_CHANNEL_DISABLED',
                        error: 'Canal de comando desabilitado por política',
                    });
                    return;
                }

                if (policy.authRequired) {
                    const dashboardUser = /** @type {any} */ (socket.dashboardUser);
                    const userRole = dashboardUser?.role || null;
                    const roleAllowed = userRole === policy.commandRole || userRole === 'owner';
                    const permAllowed = hasPermission(dashboardUser, RBAC_PERMISSIONS.DASHBOARD_COMMAND);
                    if (!roleAllowed || !permAllowed) {
                        socket.emit('dashboard:command:error', {
                            code: 'COMMAND_FORBIDDEN',
                            error: `Permissão insuficiente. Necessário role=${policy.commandRole} e ${RBAC_PERMISSIONS.DASHBOARD_COMMAND}`,
                        });
                        return;
                    }
                }

                const reason = String(data?.reason || '').trim();
                if (parseBooleanEnv('CONTROL_REQUIRE_REASON', true) && !reason) {
                    socket.emit('dashboard:command:error', {
                        code: 'COMMAND_REASON_REQUIRED',
                        error: 'Campo reason é obrigatório para comandos dashboard',
                    });
                    return;
                }

                log('DEBUG', `[HUB] Dashboard command received: ${JSON.stringify(data)}`);
                internalEmitter.emit('dashboard:command', {
                    ...data,
                    actor: socket.dashboardUser || null,
                });
            });

            socket.on('dashboard:status_request', (/** @type {any} */ data) => {
                log('DEBUG', `[HUB] Dashboard status request received`);
                internalEmitter.emit('dashboard:status_request', data);
            });
        }

        socket.on('disconnect', (/** @type {any} */ reason) => {
            if (socket.robot_id) {
                agentRegistry.delete(socket.robot_id);
                log('WARN', `[HUB] Maestro ${socket.robot_id} desconectado. Causa: ${reason}`);

                // Notifica os terminais sobre a queda do agente para atualização de UI
                ioInstance.to('dashboards').emit('hub:agent_offline', { robot_id: socket.robot_id });
            } else {
                // Dashboard disconnection
                log('DEBUG', `[HUB] Terminal Dashboard desconectado: ${socket.id}`);
                internalEmitter.emit('client:disconnected', socket.id);
            }
        });
    });

    return ioInstance;
}

/**
 * Protocolo de Comunicação Soberana para o Maestro. Implementa Handshake, Promoção de Estado e Roteamento de Envelopes.
 *
 * @param {any} socket
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
    socket.on('handshake:present', (/** @type {any} */ data) => {
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
                last_seen: Date.now(),
            });

            // O Maestro entra em salas privadas para comandos direcionados (Unicast)
            socket.join('system_agents');
            socket.join(`agent:${identity.robot_id}`);

            log('INFO', `[HUB] Maestro Homologado: DNA ${identity.robot_id}`);

            // Resposta de Autorização (Handshake ACK)
            socket.emit('handshake:authorized', {
                session_id: socket.id,
                server_ts: Date.now(),
            });

            // Notifica Dashboards sobre o novo agente pronto para missões
            ioInstance.to('dashboards').emit('hub:agent_online', identity);
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            log('ERROR', `[HUB] Handshake rejeitado para ${socket.id}: ${_e.message}`);
            socket.emit('handshake:rejected', { reason: _e.message });
            socket.disconnect();
        }
    });

    // 2. RECEPTOR DE MENSAGENS ESTRUTURADAS (Envelope V2)
    socket.on('message', (/** @type {any} */ rawEnvelope) => {
        if (!socket.authorized) {
            return;
        }

        try {
            // Validação Nativa de Integridade de Envelope
            const envelope = validateIPCEnvelope(rawEnvelope);

            /**
             * ROTEAMENTO DE TELEMETRIA: Toda mensagem vinda do Maestro (Eventos, ACKs, Logs) é retransmitida para os
             * terminais de monitoramento (Dashboards).
             */
            ioInstance.to('dashboards').emit('maestro:telemetry', envelope);

            // Atualiza pulsação de atividade no registry para o Supervisor
            if (agentRegistry.has(socket.robot_id)) {
                agentRegistry.get(socket.robot_id).last_seen = Date.now();
            }
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            log('ERROR', `[HUB] Envelope malformado de ${socket.robot_id}: ${_e.message}`);
        }
    });
}

/* ==========================================================================
   API DE COMANDO E CONTROLE (SERVER-SIDE)
========================================================================== */

/**
 * @typedef {object} SendCommandPayload
 * @property {any} _ Propriedades definidas via runtime.
 */
/**
 * Envia um comando estruturado para um robô específico ou para todos.
 *
 * @param {string} command - Constante ActionCode (ex: ENGINE_PAUSE).
 * @param {SendCommandPayload} payload - Conteúdo útil do comando.
 * @param {string | null} [robotId] - ID do robô alvo. Se nulo, envia para todos (Broadcast).
 * @returns {string | null} O msg_id gerado para rastreamento de ACK.
 */
function sendCommand(command, payload, robotId = null) {
    if (!ioInstance) {
        return null;
    }

    const msgId = uuidv4();
    const correlationId = /** @type {any} */ (payload).correlation_id || uuidv4();

    const envelope = {
        header: {
            version: PROTOCOL_VERSION,
            timestamp: Date.now(),
            // ActorRole.MISSION_CONTROL is not part of the canonical vocabulary.
            // This command is emitted by the SERVER hub.
            source: ActorRole.SERVER,
        },
        ids: {
            msg_id: msgId,
            correlation_id: correlationId,
        },
        kind: command,
        payload,
    };

    const target = robotId ? `agent:${robotId}` : 'system_agents';
    ioInstance.to(target).emit('message', envelope);

    log('DEBUG', `[HUB] Comando ${command} enviado para ${target}`, correlationId);
    return msgId;
}

/**
 * Encerramento atômico do Hub. Garante desconexão forçada de todos os agentes e limpeza total de memória. Essencial
 * para o ciclo de vida NASA Standard.
 *
 * @returns {Promise<void>}
 */
async function stop() {
    if (taskUpdateTimer) {
        clearTimeout(taskUpdateTimer);
        taskUpdateTimer = null;
    }
    taskUpdateBuffer.clear();
    removeConfigUpdatedListener();

    if (ioInstance) {
        log('INFO', '[HUB] Encerrando barramento e limpando conexões...');

        // Força a desconexão de todos os clientes ativos (Agentes e Dashboards)
        const sockets = await ioInstance.fetchSockets();
        for (const s of sockets) {
            s.disconnect(true);
        }

        await new Promise(
            /** @type {(resolve: (v?: any) => void) => void} */ (
                (resolve) => {
                    ioInstance.close(() => {
                        ioInstance = null;
                        resolve();
                    });
                }
            ),
        );

        agentRegistry.clear();
        log('INFO', '[HUB] Barramento Socket.io limpo com sucesso.');
    }
}

/**
 * Notify: Broadcast global informativo para todos os conectados.
 *
 * @param {any} event
 * @param {any} data
 * @returns {boolean | void}
 */
function notify(event, data) {
    if (!ioInstance) {
        return false;
    }
    ioInstance.emit(event, data);
    return true;
}

/** @typedef {any} NotifyAgentInput */
/**
 * Notify agents (system room) with a lightweight signal event. Used for wake-ups (e.g. cache invalidation) without a
 * full IPC envelope.
 *
 * @param {any} event
 * @param {NotifyAgentInput} [data]
 * @returns {boolean | void}
 */
function notifyAgent(event, data = {}) {
    if (!ioInstance) {
        return false;
    }
    ioInstance.to('system_agents').emit(event, data);
    return true;
}

/**
 * @typedef {object} BroadcastTaskUpdateInput
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * P9.8: Broadcast de task update com debouncing de 50ms. Acumula updates em buffer e envia em batch para reduzir
 * overhead.
 *
 * @param {string | object} taskId - ID da task ou objeto {taskId, state}
 * @param {BroadcastTaskUpdateInput} [data] - Dados do update (opcional se taskId for objeto)
 * @returns {void}
 */
function broadcastTaskUpdate(taskId, data) {
    if (!ioInstance) {
        return;
    }

    // Normaliza payload para contrato canônico: { taskId, state }
    let normalizedTaskId = taskId;
    let normalizedState = data;

    if (taskId && typeof taskId === 'object' && data === undefined) {
        // Suporta chamada acidental broadcastTaskUpdate({ taskId, state })
        normalizedTaskId = /** @type {any} */ (taskId).taskId;
        normalizedState = /** @type {any} */ (taskId).state;
    }

    if (!normalizedTaskId) {
        return;
    }

    // Adiciona ao buffer
    taskUpdateBuffer.set(normalizedTaskId, {
        taskId: normalizedTaskId,
        state: normalizedState || {},
        timestamp: Date.now(),
    });

    // Cancela timer anterior e agenda novo flush
    if (taskUpdateTimer) {
        clearTimeout(taskUpdateTimer);
    }

    taskUpdateTimer = setTimeout(() => {
        flushTaskUpdates();
    }, 50); // 50ms debounce window
}

/** Constante/valor exportado: getRegistry. */
export const getRegistry = () =>
    Array.from(agentRegistry.entries()).map(([robot_id, entry]) => ({
        robot_id,
        ...entry,
    }));
/** Constante/valor exportado: getIO. */
export const getIO = () => ioInstance;
/**
 * Constante/valor exportado: on.
 *
 * @param {string | symbol} eventName
 * @param {(...args: unknown[]) => void} handler
 */
export const on = (eventName, handler) => internalEmitter.on(eventName, handler);
/**
 * Constante/valor exportado: once.
 *
 * @param {string | symbol} eventName
 * @param {(...args: unknown[]) => void} handler
 */
export const once = (eventName, handler) => internalEmitter.once(eventName, handler);
/**
 * Constante/valor exportado: off.
 *
 * @param {string | symbol} eventName
 * @param {(...args: unknown[]) => void} handler
 */
export const off = (eventName, handler) => internalEmitter.off(eventName, handler);
/**
 * Constante/valor exportado: emit.
 *
 * @param {any} eventName
 */
export const emit = (/** @type {any} */ eventName, /** @type {...any} */ ...args) =>
    /** @type {EventEmitter} */ (internalEmitter).emit(eventName, ...args);

/**
 * Constante/valor exportado: sendToClient.
 *
 * @param {any} clientId
 * @param {any} eventName
 * @param {any} data
 */
export const sendToClient = (clientId, eventName, data) => {
    if (!ioInstance) {
        log('WARN', '[HUB] Tentativa de enviar evento sem io instance');
        return;
    }
    const socket = ioInstance.sockets.sockets.get(clientId);
    if (socket) {
        socket.emit(eventName, data);
    } else {
        log('WARN', `[HUB] Cliente ${clientId} não encontrado para evento ${eventName}`);
    }
};

/**
 * Constante/valor exportado: connectExternal.
 *
 * @param {any} [port]
 */
export const connectExternal = async (port = 3008) => {
    const { io: ioClient } = await import('socket.io-client');
    const url = `http://localhost:${port}`;
    const connectTimeoutMs = Number(process.env['SPLIT_CONNECT_TIMEOUT_MS'] || 5000) || 5000;
    const handshakeTimeoutMs = Number(process.env['SPLIT_HANDSHAKE_TIMEOUT_MS'] || 5000) || 5000;

    log('INFO', `[HUB] Conectando a servidor externo: ${url}`);

    const clientSocket = ioClient(url, {
        auth: { token: 'SYSTEM_MAESTRO_PRIME' },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
    });

    const handshakeIdentity = {
        robot_id: process.env['ROBOT_ID'] || `maestro-${process.pid}`,
        instance_id: process.env['NODE_APP_INSTANCE'] || String(process.pid),
        role: ActorRole.MAESTRO,
        version: PROTOCOL_VERSION,
        capabilities: ['split-mode', 'external-socket'],
    };

    const performHandshake = async () =>
        new Promise(
            /** @type {(resolve: (v?: any) => void, reject: (e: any) => void) => void} */ (
                (resolve, reject) => {
                    const onAuthorized = () => {
                        cleanup();
                        resolve();
                    };

                    const onRejected = (/** @type {any} */ payload) => {
                        cleanup();
                        reject(new Error(`Handshake rejected: ${payload?.reason || 'unknown reason'}`));
                    };

                    const onDisconnect = (/** @type {any} */ reason) => {
                        cleanup();
                        reject(new Error(`Disconnected before handshake authorization: ${reason}`));
                    };

                    const timer = setTimeout(() => {
                        cleanup();
                        reject(new Error(`Timeout waiting for handshake authorization (${handshakeTimeoutMs}ms)`));
                    }, handshakeTimeoutMs);

                    function cleanup() {
                        clearTimeout(timer);
                        clientSocket.off('handshake:authorized', onAuthorized);
                        clientSocket.off('handshake:rejected', onRejected);
                        clientSocket.off('disconnect', onDisconnect);
                    }

                    clientSocket.on('handshake:authorized', onAuthorized);
                    clientSocket.on('handshake:rejected', onRejected);
                    clientSocket.on('disconnect', onDisconnect);
                    clientSocket.emit('handshake:present', { identity: handshakeIdentity });
                }
            ),
        );

    // Reaplica handshake a cada (re)conexão para evitar queda por timeout no servidor.
    /** @type {any} */
    let handshakeInFlight = null;
    const runHandshake = async () => {
        if (!handshakeInFlight) {
            handshakeInFlight = performHandshake().finally(() => {
                handshakeInFlight = null;
            });
        }
        return handshakeInFlight;
    };

    let initialReadySettled = false;
    await new Promise(
        /** @type {(resolve: (v?: any) => void, reject: (e: any) => void) => void} */ (
            (resolve, reject) => {
                const initialReadyTimeoutMs = connectTimeoutMs + handshakeTimeoutMs;
                const timer = setTimeout(() => {
                    settleReject(
                        new Error(`Timeout connecting and authorizing external server (${initialReadyTimeoutMs}ms)`),
                    );
                }, initialReadyTimeoutMs);

                const settleResolve = () => {
                    if (initialReadySettled) {
                        return;
                    }
                    initialReadySettled = true;
                    clearTimeout(timer);
                    clientSocket.off('connect_error', onConnectError);
                    resolve();
                };

                const settleReject = (/** @type {any} */ err) => {
                    if (initialReadySettled) {
                        return;
                    }
                    initialReadySettled = true;
                    clearTimeout(timer);
                    clientSocket.off('connect_error', onConnectError);
                    reject(err instanceof Error ? err : new Error(String(err)));
                };

                const onConnectError = (/** @type {any} */ err) => {
                    if (!initialReadySettled) {
                        settleReject(err);
                    }
                };

                const onConnect = async () => {
                    log('INFO', `[HUB] ✅ Conectado a servidor externo (${url})`);
                    try {
                        await runHandshake();
                        log('INFO', '[HUB] ✅ Handshake autorizado pelo servidor externo');
                        settleResolve();
                    } catch (/** @type {any} */ err) {
                        const _e = /** @type {any} */ (err);
                        if (!initialReadySettled) {
                            settleReject(err);
                        } else {
                            log('WARN', `[HUB] Handshake em reconexão falhou: ${_e?.message || String(err)}`);
                        }
                    }
                };

                clientSocket.on('connect', onConnect);
                clientSocket.on('connect_error', onConnectError);
            }
        ),
    );

    clientSocket.on('reconnect_attempt', (attempt) => {
        log('DEBUG', `[HUB] Tentativa de reconexão ao servidor externo (#${attempt})`);
    });

    clientSocket.on('reconnect', (attempt) => {
        log('INFO', `[HUB] Reconectado ao servidor externo (#${attempt})`);
    });

    clientSocket.on('reconnect_error', (err) => {
        log('WARN', `[HUB] Erro de reconexão ao servidor externo: ${err?.message || String(err)}`);
    });

    clientSocket.on('reconnect_failed', () => {
        log('ERROR', '[HUB] Falha definitiva de reconexão ao servidor externo');
    });

    // Bridge events do cliente para o internalEmitter
    clientSocket.onAny((eventName, ...args) => {
        internalEmitter.emit(eventName, ...args);
    });

    // Retornar adaptador compatível com interface esperada
    return {
        on: (/** @type {any} */ event, /** @type {any} */ handler) => clientSocket.on(event, handler),
        off: (/** @type {any} */ event, /** @type {any} */ handler) => clientSocket.off(event, handler),
        emit: (/** @type {any} */ event, /** @type {any} */ data) => clientSocket.emit(event, data),
        // Best-effort in split mode: preserve API shape even without direct server-side socket lookup.
        sendToClient: (/** @type {any} */ clientId, /** @type {any} */ event, /** @type {any} */ data) =>
            clientSocket.emit(event, { clientId, payload: data }),
        connected: () => clientSocket.connected,
        disconnect: () => clientSocket.disconnect(),
    };
};

/**
 * Notifica todos os clientes conectados sobre shutdown iminente do servidor.
 *
 * @param {number} timeoutMs - Tempo em ms até o shutdown forçado
 * @returns {void}
 */
function notifyShutdown(timeoutMs) {
    if (!ioInstance) {
        return;
    }

    notify('system:shutdown', {
        message: 'Servidor será encerrado em breve',
        timeoutMs,
        timestamp: Date.now(),
    });
}

export { broadcastTaskUpdate, init, notify, notifyAgent, notifyShutdown, sendCommand, stop };
