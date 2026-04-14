// @ts-check
/**
 * @module copilot/server/socket/hub-ns
 * @file Namespace Socket.IO /copilot para o servidor copilot dedicado.
 *
 *   Move de `conversation-hub/socket-ns.js` para `server/socket/hub-ns.js`. O arquivo original torna-se um re-export no
 *   Onda 3.7.
 *
 *   Esta implementação É IDÊNTICA a `conversation-hub/socket-ns.js` — a separação é arquitetural (transport layer em
 *   server/, domain em conversation-hub/).
 *
 *   Onda 3.2 — L56.2.
 *
 *   src/copilot/server/socket/hub-ns.js
 */

import { COPILOT_HUB_SOCKET_AUTH_REQUIRED, DASHBOARD_SOCKET_AUTH_REQUIRED } from '#copilot/config';
import { logSwallowed } from '#copilot/core';
import { HUB_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getJwtSecret, JWT_VERIFY_OPTIONS } from '../../config/auth.js';
import { setCopilotNamespace } from '../../conversation-hub/broadcast.js';

/**
 * @typedef {import('socket.io').Namespace} SocketNamespace
 *
 * @typedef {import('socket.io').Socket} SocketClient
 */

// F132: Schema Zod para validação do token de handshake
const HandshakeAuthSchema = z.object({
    token: z.string().min(10).max(8192),
});

/**
 * Namespace Socket.io /copilot. Inicializado por mountCopilotNamespace().
 *
 * @type {SocketNamespace | null}
 */
let copilotNamespace = null;

/**
 * Monta o namespace /copilot sobre a instância Socket.io existente.
 *
 * Permite que clientes (dashboard, CLI) se conectem para:
 *
 * - Observar conversas LLM-A ↔ LLM-B em tempo real
 * - Injetar mensagens como usuário
 * - Receber histórico de uma sessão específica
 *
 * @param {import('socket.io').Server} io - Instância do socket.io Server
 * @param {import('../../conversation-hub/orchestrator.js').HubOrchestrator} orchestrator
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @returns {SocketNamespace}
 */
export function mountCopilotNamespace(io, orchestrator, store) {
    if (copilotNamespace) {
        log('WARN', '[hub-ns/copilot] Namespace /copilot já está montado. Ignorando re-mount.');
        return copilotNamespace;
    }

    const ns = io.of('/copilot');
    const checkSocketInjectRate = _createInjectRateLimiter();

    if (_parseAuthRequired()) {
        _setupAuthMiddleware(ns);
    }

    _setupConnectionHandlers(ns, orchestrator, store, checkSocketInjectRate);
    _bridgeOrchestratorEvents(ns, orchestrator);

    copilotNamespace = ns;
    setCopilotNamespace(ns);
    log('INFO', '[hub-ns/copilot] Namespace /copilot montado com sucesso.');
    return ns;
}

/**
 * Cria rate-limiter para injects com buckets por socket e por IP.
 *
 * @returns {(socketId: string, ip: string) => boolean}
 */
function _createInjectRateLimiter() {
    /** @type {Map<string, { count: number; resetAt: number }>} */
    const _socketBuckets = new Map();
    const INJECT_LIMIT = 10;
    const INJECT_WINDOW_MS = 60_000;

    /** @type {Map<string, { count: number; resetAt: number }>} */
    const _ipBuckets = new Map();
    const IP_INJECT_LIMIT = 30;

    return function checkSocketInjectRate(socketId, ip) {
        const now = Date.now();
        for (const [key, b] of _socketBuckets) {
            if (now >= b.resetAt) _socketBuckets.delete(key);
        }
        for (const [key, b] of _ipBuckets) {
            if (now >= b.resetAt) _ipBuckets.delete(key);
        }
        const ipBucket = _ipBuckets.get(ip) ?? { count: 0, resetAt: now + INJECT_WINDOW_MS };
        if (ipBucket.count >= IP_INJECT_LIMIT) return false;
        const bucket = _socketBuckets.get(socketId) ?? { count: 0, resetAt: now + INJECT_WINDOW_MS };
        if (bucket.count >= INJECT_LIMIT) return false;
        bucket.count++;
        _socketBuckets.set(socketId, bucket);
        ipBucket.count++;
        _ipBuckets.set(ip, ipBucket);
        return true;
    };
}

/**
 * Instala o middleware JWT no namespace.
 *
 * @param {SocketNamespace} ns
 * @returns {void}
 */
function _setupAuthMiddleware(ns) {
    try {
        getJwtSecret();
    } catch (/** @type {any} */ secretErr) {
        log('ERROR', `[hub-ns/copilot] JWT_SECRET inválido: ${secretErr.message}. Namespace bloqueado (fail-closed).`);
        // S-C-01 fix: fail-closed — rejeitar todas as conexões em vez de desabilitar auth
        ns.use((_socket, next) => {
            next(new Error('COPILOT_NS: Servidor sem JWT_SECRET configurado. Conexões bloqueadas.'));
        });
        return;
    }
    ns.use(async (/** @type {SocketClient} */ socket, /** @type {function} */ next) => {
        try {
            const rawToken =
                socket.handshake.auth?.['token'] || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
            const authResult = HandshakeAuthSchema.safeParse({ token: rawToken });
            if (!authResult.success) {
                log('WARN', `[hub-ns/copilot] Auth rejeitado — token malformado (IP: ${socket.handshake.address})`);
                return next(new Error('COPILOT_NS: Token ausente ou malformado.'));
            }
            const { token } = authResult.data;
            const payload = jwt.verify(token, getJwtSecret(), JWT_VERIFY_OPTIONS);
            /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (socket))['userId'] =
                /** @type {{ sub?: string }} */ (payload).sub;
            next();
        } catch (/** @type {any} */ err) {
            log('WARN', `[hub-ns/copilot] Auth falhou (IP: ${socket.handshake.address}): ${err.message}`);
            next(new Error('COPILOT_NS: Token inválido ou expirado.'));
        }
    });
}

/**
 * Registra handlers de eventos de conexão no namespace.
 *
 * @param {SocketNamespace} ns
 * @param {import('../../conversation-hub/orchestrator.js').HubOrchestrator} orchestrator
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {(socketId: string, ip: string) => boolean} checkRate
 * @returns {void}
 */
function _setupConnectionHandlers(ns, orchestrator, store, checkRate) {
    ns.on(HUB_EVENTS.CONNECTION, (/** @type {SocketClient} */ socket) => {
        const clientId = socket.id;
        const clientIp = socket.handshake.address ?? 'unknown';
        log('DEBUG', `[hub-ns/copilot] Cliente conectado: ${clientId}`);

        _handleJoinSession(socket, store, clientId);
        _handleLeaveSession(socket, clientId);
        _handleUserInject(socket, orchestrator, store, clientId, clientIp, checkRate);
        _handleSessionsList(socket, store);
        _handleTurnsHistory(socket, store);

        socket.on(HUB_EVENTS.DISCONNECT, () => {
            log('DEBUG', `[hub-ns/copilot] Cliente desconectado: ${clientId}`);
        });
    });
}

/**
 * @param {SocketClient} socket
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {string} clientId
 */
function _handleJoinSession(socket, store, clientId) {
    socket.on(HUB_EVENTS.JOIN_SESSION, (/** @type {{ hubSession: string }} */ data) => {
        if (!data?.hubSession) return;
        const sessionExists = store.getHubSession(data.hubSession);
        if (!sessionExists) {
            log('WARN', `[hub-ns] join negado — sessão '${data.hubSession}' não existe (clientId=${clientId})`);
            socket.emit(HUB_EVENTS.ERROR_JOIN, { hubSession: data.hubSession, reason: 'session_not_found' });
            return;
        }
        void socket.join(data.hubSession);
        log('DEBUG', `[hub-ns] Cliente ${clientId} entrou na sala: ${data.hubSession}`);
        socket.emit(HUB_EVENTS.JOINED_SESSION, { hubSession: data.hubSession });
    });
}

/**
 * @param {SocketClient} socket
 * @param {string} clientId
 */
function _handleLeaveSession(socket, clientId) {
    socket.on(HUB_EVENTS.LEAVE_SESSION, (/** @type {{ hubSession: string }} */ data) => {
        if (!data?.hubSession) return;
        void socket.leave(data.hubSession);
        log('DEBUG', `[hub-ns] Cliente ${clientId} saiu da sala: ${data.hubSession}`);
    });
}

/**
 * @param {SocketClient} socket
 * @param {import('../../conversation-hub/orchestrator.js').HubOrchestrator} orchestrator
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {string} clientId
 * @param {string} clientIp
 * @param {(socketId: string, ip: string) => boolean} checkRate
 */
function _handleUserInject(socket, orchestrator, store, clientId, clientIp, checkRate) {
    socket.on(HUB_EVENTS.USER_INJECT, async (/** @type {{ hubSession: string; content: string }} */ data) => {
        if (!data?.hubSession || !data?.content) {
            socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: 'hubSession e content são obrigatórios.' });
            return;
        }
        if (!checkRate(clientId, clientIp)) {
            socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: 'Rate limit excedido. Tente novamente em breve.' });
            log('WARN', `[hub-ns] Rate limit atingido pelo socket ${clientId}`);
            return;
        }
        const MAX_INJECT_CONTENT = 32_000;
        const rawContent = typeof data.content === 'string' ? data.content : String(data.content ?? '');
        const safeContent = rawContent
            .slice(0, MAX_INJECT_CONTENT)
            .replace(/^\s*\[SYSTEM[^\]]*\]/gim, '[BLOCKED]')
            .replace(/^\s*SYSTEM:/gim, '[BLOCKED]');

        try {
            const session = store.getHubSession(data.hubSession);
            if (!session || session.status !== 'active') {
                socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: `Sessão ${data.hubSession} não está ativa.` });
                return;
            }
            const turnId = await orchestrator.injectUserMessage(data.hubSession, safeContent, {
                metadata: {
                    injectedBy:
                        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (socket))['userId'] ??
                        'anonymous',
                    socketId: clientId,
                },
            });
            socket.emit(HUB_EVENTS.INJECT_ACK, { hubSession: data.hubSession, turnId });
            log('INFO', `[hub-ns] Mensagem injetada pelo usuário na sessão ${data.hubSession}.`);
        } catch (/** @type {any} */ err) {
            socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: err.message ?? String(err) });
            log('ERROR', `[hub-ns] Erro ao injetar mensagem: ${err.message ?? String(err)}`);
        }
    });
}

/**
 * @param {SocketClient} socket
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 */
function _handleSessionsList(socket, store) {
    socket.on(HUB_EVENTS.SESSIONS_LIST, (/** @type {{ limit?: number; offset?: number; status?: string }} */ opts) => {
        try {
            const VALID_STATUS = new Set(['active', 'closed', 'error']);
            const rawStatus = opts?.status;
            if (rawStatus !== undefined && !VALID_STATUS.has(rawStatus)) {
                socket.emit(HUB_EVENTS.ERROR_SESSIONS, { reason: `status inválido: "${rawStatus}"` });
                return;
            }
            const statusVal =
                /** @type {import('../../conversation-hub/store-helpers.js').HubSessionStatus | undefined} */ (
                    rawStatus
                );
            const sessions = store.listHubSessions({
                limit: opts?.limit ?? 20,
                offset: opts?.offset ?? 0,
                ...(statusVal !== undefined ? { status: statusVal } : {}),
            });
            const publicSessions = sessions.map((s) => ({
                id: s.id,
                title: s.title,
                status: s.status,
                created_at: s.created_at,
                updated_at: s.updated_at,
            }));
            socket.emit(HUB_EVENTS.SESSIONS_LIST_RESULT, { sessions: publicSessions });
        } catch (/** @type {any} */ err) {
            socket.emit(HUB_EVENTS.ERROR_SESSIONS, { reason: err.message });
        }
    });
}

/**
 * @param {SocketClient} socket
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 */
function _handleTurnsHistory(socket, store) {
    socket.on(
        HUB_EVENTS.TURNS_HISTORY,
        (/** @type {{ hubSession: string; limit?: number; offset?: number; after?: number }} */ data) => {
            if (!data?.hubSession) return;
            if (!socket.rooms.has(data.hubSession)) {
                socket.emit(HUB_EVENTS.ERROR_HISTORY, { reason: 'not_in_session: execute join:session primeiro.' });
                return;
            }
            try {
                const turns = store.readTurns(data.hubSession, {
                    limit: data.limit ?? 50,
                    offset: data.offset ?? 0,
                    ...(data.after !== undefined && { after: data.after }),
                });
                socket.emit(HUB_EVENTS.TURNS_HISTORY_RESULT, { hubSession: data.hubSession, turns });
            } catch (/** @type {any} */ err) {
                socket.emit(HUB_EVENTS.ERROR_HISTORY, { reason: err.message });
            }
        },
    );
}

/**
 * Bridge de eventos do HubOrchestrator para o namespace Socket.IO.
 *
 * @param {SocketNamespace} ns
 * @param {import('../../conversation-hub/orchestrator.js').HubOrchestrator} orchestrator
 * @returns {void}
 */
function _bridgeOrchestratorEvents(ns, orchestrator) {
    orchestrator.on(HUB_EVENTS.SESSION_CREATED, (/** @type {{ hubSessionId: string; title: string }} */ data) => {
        ns.emit(HUB_EVENTS.SESSION_CREATED, data);
    });

    orchestrator.on(HUB_EVENTS.SESSION_CLOSED, (/** @type {{ hubSessionId: string }} */ data) => {
        ns.to(data.hubSessionId).emit(HUB_EVENTS.SESSION_CLOSED, data);
    });

    orchestrator.on(
        HUB_EVENTS.TURN_SENT,
        (
            /** @type {{ hubSessionId: string; turnId: number; role: string; content: string; turnNumber: number }} */ data,
        ) => {
            ns.to(data.hubSessionId).emit(HUB_EVENTS.TURN_SENT, data);
        },
    );

    orchestrator.on(
        HUB_EVENTS.TURN_DELTA,
        (/** @type {{ hubSessionId: string; chunk: string; turnNumber: number }} */ data) => {
            ns.to(data.hubSessionId).emit(HUB_EVENTS.TURN_DELTA, data);
        },
    );

    orchestrator.on(
        HUB_EVENTS.TURN_COMPLETE,
        (
            /**
             * @type {{
             *     hubSessionId: string;
             *     turnId: number;
             *     role: string;
             *     content: string;
             *     structured: any;
             *     durationMs: number;
             *     turnNumber: number;
             * }}
             */ data,
        ) => {
            ns.to(data.hubSessionId).emit(HUB_EVENTS.TURN_COMPLETE, data);
        },
    );

    orchestrator.on(
        HUB_EVENTS.USER_INJECTED,
        (/** @type {{ hubSessionId: string; turnId: number; content: string }} */ data) => {
            ns.to(data.hubSessionId).emit(HUB_EVENTS.USER_INJECTED, data);
        },
    );

    orchestrator.on('error', (/** @type {{ hubSessionId: string; message: string; error: Error }} */ data) => {
        ns.to(data.hubSessionId).emit(HUB_EVENTS.HUB_ERROR, {
            hubSessionId: data.hubSessionId,
            message: data.message,
        });
    });
}

/**
 * Retorna o namespace /copilot já montado, ou null se ainda não inicializado.
 *
 * @returns {SocketNamespace | null}
 */
export function getCopilotNamespace() {
    return copilotNamespace;
}

/**
 * Desmonta o namespace /copilot, desconectando todos os clients.
 *
 * @returns {void}
 */
export function unmountCopilotNamespace() {
    if (!copilotNamespace) return;
    try {
        copilotNamespace.disconnectSockets(true);
        copilotNamespace.removeAllListeners();
    } catch (/** @type {any} */ e) {
        logSwallowed(e, 'hub.socketNs.unmount');
    }
    copilotNamespace = null;
    setCopilotNamespace(null);
}

/**
 * Determina se autenticação é obrigatória no namespace /copilot.
 *
 * @returns {boolean}
 */
function _parseAuthRequired() {
    const envVal = COPILOT_HUB_SOCKET_AUTH_REQUIRED;
    if (envVal !== undefined) {
        const lower = String(envVal).trim().toLowerCase();
        if (lower === '0' || lower === 'false' || lower === 'no') return false;
        if (lower === '1' || lower === 'true' || lower === 'yes') return true;
    }
    const dashVal = DASHBOARD_SOCKET_AUTH_REQUIRED;
    if (dashVal !== undefined) {
        const lower = String(dashVal).trim().toLowerCase();
        if (lower === '0' || lower === 'false' || lower === 'no') return false;
    }
    return true;
}
