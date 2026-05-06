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
import { logSwallowed, toError } from '#copilot/core';
import { HUB_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getJwtSecret, JWT_VERIFY_OPTIONS } from '../../config/auth.js';
import { authorizeHubSessionAction, createHubAccessPrincipal } from '../../conversation-hub/access.js';
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
    _bridgeOrchestratorEvents(ns, orchestrator, store);

    copilotNamespace = ns;
    setCopilotNamespace(ns);
    log('INFO', '[hub-ns/copilot] Namespace /copilot montado com sucesso.');
    return ns;
}

/**
 * Cria telemetria de volume para injects com buckets por socket e por IP. Não bloqueia operações da LLM-B.
 *
 * @returns {(socketId: string, ip: string) => boolean}
 */
function _createInjectRateLimiter() {
    /** @type {Map<string, { count: number; resetAt: number }>} */
    const _socketBuckets = new Map();
    const INJECT_WINDOW_MS = 60_000;

    /** @type {Map<string, { count: number; resetAt: number }>} */
    const _ipBuckets = new Map();
    return function checkSocketInjectRate(socketId, ip) {
        const now = Date.now();
        for (const [key, b] of _socketBuckets) {
            if (now >= b.resetAt) _socketBuckets.delete(key);
        }
        for (const [key, b] of _ipBuckets) {
            if (now >= b.resetAt) _ipBuckets.delete(key);
        }
        const ipBucket = _ipBuckets.get(ip) ?? { count: 0, resetAt: now + INJECT_WINDOW_MS };
        const bucket = _socketBuckets.get(socketId) ?? { count: 0, resetAt: now + INJECT_WINDOW_MS };
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
    } catch (secretErr) {
        log(
            'ERROR',
            `[hub-ns/copilot] JWT_SECRET inválido: ${toError(secretErr).message}. Namespace bloqueado (fail-closed).`,
        );
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
            const principal = createHubAccessPrincipal(payload);
            /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (socket))['userId'] =
                /** @type {{ sub?: string }} */ (payload).sub;
            _getSocketRuntime(socket).principal = principal;
            next();
        } catch (err) {
            log('WARN', `[hub-ns/copilot] Auth falhou (IP: ${socket.handshake.address}): ${toError(err).message}`);
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
        const authorization = _authorizeSocketSession(socket, store, data.hubSession, 'read');
        if (!authorization.session) {
            log('WARN', `[hub-ns] join negado — sessão '${data.hubSession}' não existe (clientId=${clientId})`);
            socket.emit(HUB_EVENTS.ERROR_JOIN, { hubSession: data.hubSession, reason: 'session_not_found' });
            return;
        }
        if (!authorization.decision.ok) {
            log(
                'WARN',
                `[hub-ns] join negado — sessão '${data.hubSession}' sem permissão (${authorization.decision.reason}, clientId=${clientId})`,
            );
            socket.emit(HUB_EVENTS.ERROR_JOIN, {
                hubSession: data.hubSession,
                reason: authorization.decision.reason,
            });
            return;
        }
        void socket.join(data.hubSession);
        _getSocketRuntime(socket).authorizedHubSessions.add(data.hubSession);
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
        _getSocketRuntime(socket).authorizedHubSessions.delete(data.hubSession);
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
        const authorization = _authorizeSocketSession(socket, store, data.hubSession, 'write');
        if (!authorization.session) {
            socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: 'session_not_found' });
            return;
        }
        if (!authorization.decision.ok) {
            socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: authorization.decision.reason });
            log(
                'WARN',
                `[hub-ns] inject negado — sessão '${data.hubSession}' sem permissão (${authorization.decision.reason}, clientId=${clientId})`,
            );
            return;
        }
        if (!checkRate(clientId, clientIp)) {
            log('DEBUG', `[hub-ns] Inject volume alto observado pelo socket ${clientId}; operação liberada.`);
        }
        const rawContent = typeof data.content === 'string' ? data.content : String(data.content ?? '');
        const safeContent = rawContent
            .replace(/^\s*\[SYSTEM[^\]]*\]/gim, '[BLOCKED]')
            .replace(/^\s*SYSTEM:/gim, '[BLOCKED]');

        try {
            const session = authorization.session;
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
        } catch (err) {
            socket.emit(HUB_EVENTS.ERROR_INJECT, { reason: toError(err).message ?? String(err) });
            log('ERROR', `[hub-ns] Erro ao injetar mensagem: ${toError(err).message ?? String(err)}`);
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
            const principal = _getSocketRuntime(socket).principal;
            const sessions = _listAuthorizedSessions(store, principal, {
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
        } catch (err) {
            socket.emit(HUB_EVENTS.ERROR_SESSIONS, { reason: toError(err).message });
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
            const authorization = _authorizeSocketSession(socket, store, data.hubSession, 'read');
            if (!authorization.session) {
                socket.emit(HUB_EVENTS.ERROR_HISTORY, { reason: 'session_not_found' });
                return;
            }
            if (!authorization.decision.ok) {
                socket.emit(HUB_EVENTS.ERROR_HISTORY, { reason: authorization.decision.reason });
                return;
            }
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
            } catch (err) {
                socket.emit(HUB_EVENTS.ERROR_HISTORY, { reason: toError(err).message });
            }
        },
    );
}

/**
 * Bridge de eventos do HubOrchestrator para o namespace Socket.IO.
 *
 * @param {SocketNamespace} ns
 * @param {import('../../conversation-hub/orchestrator.js').HubOrchestrator} orchestrator
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @returns {void}
 */
function _bridgeOrchestratorEvents(ns, orchestrator, store) {
    orchestrator.on(HUB_EVENTS.SESSION_CREATED, (/** @type {{ hubSessionId: string; title: string }} */ data) => {
        _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.SESSION_CREATED, data, {
            requireRoomMembership: false,
        });
    });

    orchestrator.on(HUB_EVENTS.SESSION_CLOSED, (/** @type {{ hubSessionId: string }} */ data) => {
        _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.SESSION_CLOSED, data);
    });

    orchestrator.on(
        HUB_EVENTS.TURN_SENT,
        (
            /** @type {{ hubSessionId: string; turnId: number; role: string; content: string; turnNumber: number }} */ data,
        ) => {
            _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.TURN_SENT, data);
        },
    );

    orchestrator.on(
        HUB_EVENTS.TURN_DELTA,
        (/** @type {{ hubSessionId: string; chunk: string; turnNumber: number }} */ data) => {
            _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.TURN_DELTA, data);
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
             *     structured: Record<string, unknown> | null;
             *     durationMs: number;
             *     turnNumber: number;
             * }}
             */ data,
        ) => {
            _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.TURN_COMPLETE, data);
        },
    );

    orchestrator.on(
        HUB_EVENTS.USER_INJECTED,
        (/** @type {{ hubSessionId: string; turnId: number; content: string }} */ data) => {
            _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.USER_INJECTED, data);
        },
    );

    orchestrator.on('error', (/** @type {{ hubSessionId: string; message: string; error: Error }} */ data) => {
        _emitAuthorizedSessionEvent(ns, store, data.hubSessionId, HUB_EVENTS.HUB_ERROR, {
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
    } catch (e) {
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

/**
 * @typedef {{
 *     principal: import('../../conversation-hub/access.js').HubAccessPrincipal;
 *     authorizedHubSessions: Set<string>;
 * }} SocketRuntime
 */

/**
 * @param {SocketClient} socket
 * @returns {SocketRuntime}
 */
function _getSocketRuntime(socket) {
    /** @type {Record<string, unknown>} */
    const socketData = /** @type {Record<string, unknown>} */ (socket.data ?? {});
    if (!(socketData['copilotSocketRuntime'] instanceof Object)) {
        socketData['copilotSocketRuntime'] = {
            principal: createHubAccessPrincipal({}),
            authorizedHubSessions: new Set(),
        };
    }
    return /** @type {SocketRuntime} */ (socketData['copilotSocketRuntime']);
}

/**
 * @param {SocketClient} socket
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {string} hubSessionId
 * @param {import('../../conversation-hub/access.js').HubSessionAction} action
 * @returns {{
 *     session: import('../../conversation-hub/store-helpers.js').HubSession | null;
 *     decision: import('../../conversation-hub/access.js').HubSessionAccessDecision;
 * }}
 */
function _authorizeSocketSession(socket, store, hubSessionId, action) {
    const session = store.getHubSession(hubSessionId);
    if (!session) {
        return {
            session: null,
            decision: {
                ok: false,
                reason: 'session_not_found',
                policy: authorizeHubSessionAction(createHubAccessPrincipal({}), { id: hubSessionId }, 'read').policy,
            },
        };
    }
    return {
        session,
        decision: authorizeHubSessionAction(_getSocketRuntime(socket).principal, session, action),
    };
}

/**
 * Lista sessões filtrando por autorização antes de paginar, evitando starvation por sessões não autorizadas.
 *
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {import('../../conversation-hub/access.js').HubAccessPrincipal} principal
 * @param {{
 *     limit?: number;
 *     offset?: number;
 *     status?: import('../../conversation-hub/store-helpers.js').HubSessionStatus;
 * }} [opts]
 * @returns {import('../../conversation-hub/store-helpers.js').HubSession[]}
 */
function _listAuthorizedSessions(store, principal, opts = {}) {
    const requestedLimit =
        typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
            ? Math.trunc(opts.limit)
            : Number.POSITIVE_INFINITY;
    const requestedOffset = Math.max(0, opts.offset ?? 0);
    const targetCount = Number.isFinite(requestedLimit) ? requestedLimit + requestedOffset : Number.POSITIVE_INFINITY;
    const pageSize = Number.isFinite(targetCount) ? Math.max(50, targetCount * 3) : 1_000;
    /** @type {import('../../conversation-hub/store-helpers.js').HubSession[]} */
    const authorized = [];

    let cursor = 0;
    while (authorized.length < targetCount) {
        const batch = store.listHubSessions({
            limit: pageSize,
            offset: cursor,
            ...(opts.status !== undefined ? { status: opts.status } : {}),
        });
        if (batch.length === 0) break;

        for (const session of batch) {
            if (authorizeHubSessionAction(principal, session, 'read').ok) authorized.push(session);
        }

        cursor += batch.length;
        if (batch.length < pageSize) break;
    }

    return Number.isFinite(requestedLimit)
        ? authorized.slice(requestedOffset, requestedOffset + requestedLimit)
        : authorized.slice(requestedOffset);
}

/**
 * Emite eventos de sessão apenas para sockets atualmente autorizados.
 *
 * @param {SocketNamespace} ns
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {string} hubSessionId
 * @param {string} eventName
 * @param {unknown} payload
 * @param {{ requireRoomMembership?: boolean }} [opts]
 * @returns {void}
 */
function _emitAuthorizedSessionEvent(ns, store, hubSessionId, eventName, payload, opts = {}) {
    const session = store.getHubSession(hubSessionId);
    if (!session) return;

    for (const socket of ns.sockets.values()) {
        const runtime = _getSocketRuntime(socket);
        if (!authorizeHubSessionAction(runtime.principal, session, 'read').ok) continue;
        if (opts.requireRoomMembership !== false && !socket.rooms.has(hubSessionId)) continue;
        socket.emit(eventName, payload);
    }
}
