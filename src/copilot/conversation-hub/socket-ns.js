// @ts-check
/**
 * src/copilot/conversation-hub/socket-ns.js
 *
 * Namespace Socket.io dedicado /copilot para streaming em tempo real do ambiente permanente LLM-A ↔ LLM-B ↔ Usuário.
 *
 * Monta o namespace /copilot sobre a instância Socket.io existente do main-server, reusando a autenticação JWT quando
 * habilitada.
 *
 * @module copilot/conversation-hub/socket-ns
 */

import { getJwtSecret, JWT_VERIFY_OPTIONS } from '#core/jwt_config';
import { log } from '#core/logger';
import jwt from 'jsonwebtoken';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {import('socket.io').Namespace} SocketNamespace
 *
 * @typedef {import('socket.io').Socket} SocketClient
 */

// ─── Namespace /copilot ───────────────────────────────────────────────────────

/**
 * Namespace Socket.io /copilot. Inicializado por mountCopilotNamespace().
 *
 * @type {SocketNamespace | null}
 */
let copilotNamespace = null;

/**
 * Monta o namespace /copilot sobre a instância Socket.io existente.
 *
 * O namespace permite que clientes (dashboard, CLI) se conectem para:
 *
 * - Observar conversas LLM-A ↔ LLM-B em tempo real
 * - Injetar mensagens como usuário
 * - Receber histórico de uma sessão específica
 *
 * Autenticação: reutiliza a configuração `DASHBOARD_SOCKET_AUTH_REQUIRED` do main namespace, mas com flag própria
 * `COPILOT_HUB_SOCKET_AUTH_REQUIRED` para override.
 *
 * @param {any} io - Instância do `socket.io` Server existente
 * @param {import('./orchestrator.js').HubOrchestrator} orchestrator
 * @param {import('./store.js').ConversationStore} store
 * @returns {SocketNamespace}
 */
export function mountCopilotNamespace(io, orchestrator, store) {
    if (copilotNamespace) {
        log('WARN', '[socket-ns/copilot] Namespace /copilot já está montado. Ignorando re-mount.');
        return copilotNamespace;
    }

    const ns = io.of('/copilot');

    // Autenticação opcional (controlada por env var ou herda do namespace principal)
    const authRequired = _parseAuthRequired();

    if (authRequired) {
        // BUG-09 (fix): importações JWT movidas para top-level para evitar overhead por conexão
        ns.use(async (/** @type {SocketClient} */ socket, /** @type {function} */ next) => {
            try {
                const token =
                    socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

                if (!token) {
                    return next(new Error('COPILOT_NS: Token de autenticação ausente.'));
                }

                const payload = jwt.verify(token, getJwtSecret(), /** @type {any} */ (JWT_VERIFY_OPTIONS));
                /** @type {any} */ (socket).userId = /** @type {any} */ (payload).sub;
                next();
            } catch (/** @type {any} */ err) {
                log('WARN', `[socket-ns/copilot] Auth falhou: ${err.message}`);
                next(new Error('COPILOT_NS: Token inválido ou expirado.'));
            }
        });
    }

    // Conexão de clients
    ns.on('connection', (/** @type {SocketClient} */ socket) => {
        const clientId = socket.id;
        log('DEBUG', `[socket-ns/copilot] Cliente conectado: ${clientId}`);

        // ── Eventos recebidos do cliente ─────────────────────────────────────

        /**
         * Entrar em uma sala específica de hub_session para receber eventos apenas daquela conversa.
         */
        socket.on('join:session', (/** @type {{ hubSession: string }} */ data) => {
            if (!data?.hubSession) return;
            // SEC-05 (fix): verificar que a sessão existe no store antes de entrar na sala
            // Sem isso, um cliente poderia criar salas com IDs arbitrários e receber eventos de broadcast
            const sessionExists = store.getHubSession(data.hubSession);
            if (!sessionExists) {
                log(
                    'WARN',
                    `[socket-ns/copilot] join:session negado — sessão '${data.hubSession}' não existe (clientId=${clientId})`,
                );
                socket.emit('error:join', { hubSession: data.hubSession, reason: 'session_not_found' });
                return;
            }
            void socket.join(data.hubSession);
            log('DEBUG', `[socket-ns/copilot] Cliente ${clientId} entrou na sala: ${data.hubSession}`);
            socket.emit('joined:session', { hubSession: data.hubSession });
        });

        /**
         * Sair de uma sala de hub_session.
         */
        socket.on('leave:session', (/** @type {{ hubSession: string }} */ data) => {
            if (!data?.hubSession) return;
            void socket.leave(data.hubSession);
            log('DEBUG', `[socket-ns/copilot] Cliente ${clientId} saiu da sala: ${data.hubSession}`);
        });

        /**
         * Usuário injeta mensagem em uma hub_session ativa.
         */
        socket.on('user:inject', (/** @type {{ hubSession: string; content: string }} */ data) => {
            if (!data?.hubSession || !data?.content) {
                socket.emit('error:inject', { reason: 'hubSession e content são obrigatórios.' });
                return;
            }

            try {
                const session = store.getHubSession(data.hubSession);
                if (!session || session.status !== 'active') {
                    socket.emit('error:inject', {
                        reason: `Sessão ${data.hubSession} não está ativa.`,
                    });
                    return;
                }

                const turnId = orchestrator.injectUserMessage(data.hubSession, data.content, {
                    metadata: {
                        injectedBy: /** @type {any} */ (socket).userId ?? 'anonymous',
                        socketId: clientId,
                    },
                });

                socket.emit('inject:ack', { hubSession: data.hubSession, turnId });
                log('INFO', `[socket-ns/copilot] Mensagem injetada pelo usuário na sessão ${data.hubSession}.`);
            } catch (/** @type {any} */ err) {
                socket.emit('error:inject', { reason: err.message });
                log('ERROR', `[socket-ns/copilot] Erro ao injetar mensagem: ${err.message}`);
            }
        });

        /**
         * Cliente solicita lista de sessões.
         */
        socket.on('sessions:list', (/** @type {{ limit?: number; offset?: number; status?: string }} */ opts) => {
            try {
                const sessions = store.listHubSessions({
                    limit: opts?.limit ?? 20,
                    offset: opts?.offset ?? 0,
                    status: /** @type {any} */ (opts?.status),
                });
                socket.emit('sessions:list:result', { sessions });
            } catch (/** @type {any} */ err) {
                socket.emit('error:sessions', { reason: err.message });
            }
        });

        /**
         * Cliente solicita histórico de turns de uma sessão.
         */
        socket.on(
            'turns:history',
            (/** @type {{ hubSession: string; limit?: number; offset?: number; after?: number }} */ data) => {
                if (!data?.hubSession) return;
                try {
                    const turns = store.readTurns(data.hubSession, {
                        limit: data.limit ?? 50,
                        offset: data.offset ?? 0,
                        ...(data.after !== undefined && { after: data.after }),
                    });
                    socket.emit('turns:history:result', { hubSession: data.hubSession, turns });
                } catch (/** @type {any} */ err) {
                    socket.emit('error:history', { reason: err.message });
                }
            },
        );

        socket.on('disconnect', () => {
            log('DEBUG', `[socket-ns/copilot] Cliente desconectado: ${clientId}`);
        });
    });

    // ── Bridge de eventos do Orchestrator → Namespace ────────────────────────

    orchestrator.on('session:created', (/** @type {{ hubSessionId: string; title: string }} */ data) => {
        ns.emit('session:created', data);
    });

    orchestrator.on('session:closed', (/** @type {{ hubSessionId: string }} */ data) => {
        ns.to(data.hubSessionId).emit('session:closed', data);
    });

    orchestrator.on(
        'turn:sent',
        (
            /** @type {{ hubSessionId: string; turnId: number; role: string; content: string; turnNumber: number }} */ data,
        ) => {
            ns.to(data.hubSessionId).emit('turn:sent', data);
        },
    );

    orchestrator.on('turn:delta', (/** @type {{ hubSessionId: string; chunk: string; turnNumber: number }} */ data) => {
        ns.to(data.hubSessionId).emit('turn:delta', data);
    });

    orchestrator.on(
        'turn:complete',
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
            ns.to(data.hubSessionId).emit('turn:complete', data);
        },
    );

    orchestrator.on(
        'user:injected',
        (/** @type {{ hubSessionId: string; turnId: number; content: string }} */ data) => {
            ns.to(data.hubSessionId).emit('user:injected', data);
        },
    );

    orchestrator.on('error', (/** @type {{ hubSessionId: string; message: string; error: Error }} */ data) => {
        ns.to(data.hubSessionId).emit('hub:error', {
            hubSessionId: data.hubSessionId,
            message: data.message,
        });
    });

    copilotNamespace = ns;
    log('INFO', '[socket-ns/copilot] Namespace /copilot montado com sucesso.');
    return ns;
}

/**
 * Retorna o namespace /copilot já montado, ou null se ainda não foi inicializado.
 *
 * @returns {SocketNamespace | null}
 */
export function getCopilotNamespace() {
    return copilotNamespace;
}

/**
 * ARCH-06 fix: Desmonta o namespace /copilot, desconectando todos os clients e limpando a referência. Deve ser chamado
 * em ConversationHub.stop() para evitar estado inconsistente após restart.
 *
 * @returns {void}
 */
export function unmountCopilotNamespace() {
    if (!copilotNamespace) return;
    try {
        copilotNamespace.disconnectSockets(true);
        copilotNamespace.removeAllListeners();
    } catch {
        // ignorar erros de desmonte
    }
    copilotNamespace = null;
}

/**
 * Emite um evento para todos os clients em uma hub_session específica.
 *
 * @param {string} hubSessionId
 * @param {string} event
 * @param {any} payload
 * @returns {void}
 */
export function broadcastToSession(hubSessionId, event, payload) {
    if (!copilotNamespace) {
        log('WARN', `[socket-ns/copilot] Namespace não montado. Broadcast '${event}' ignorado.`);
        return;
    }
    copilotNamespace.to(hubSessionId).emit(event, payload);
}

/**
 * Emite um evento para todos os clients conectados ao namespace.
 *
 * @param {string} event
 * @param {any} payload
 * @returns {void}
 */
export function broadcastGlobal(event, payload) {
    if (!copilotNamespace) return;
    copilotNamespace.emit(event, payload);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determina se a autenticação é obrigatória no namespace /copilot.
 *
 * @returns {boolean}
 */
function _parseAuthRequired() {
    const envVal = process.env.COPILOT_HUB_SOCKET_AUTH_REQUIRED;
    if (envVal !== undefined) {
        const lower = String(envVal).trim().toLowerCase();
        if (lower === '0' || lower === 'false' || lower === 'no') return false;
        if (lower === '1' || lower === 'true' || lower === 'yes') return true;
    }
    // Por default, herda de DASHBOARD_SOCKET_AUTH_REQUIRED (default: true em produção)
    const dashVal = process.env.DASHBOARD_SOCKET_AUTH_REQUIRED;
    if (dashVal !== undefined) {
        const lower = String(dashVal).trim().toLowerCase();
        if (lower === '0' || lower === 'false' || lower === 'no') return false;
    }
    return true;
}
