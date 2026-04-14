// @ts-check
/**
 * @module copilot/server/socket
 * @file Factory Socket.IO para o servidor copilot dedicado.
 *
 *   Cria e configura o servidor Socket.IO sobre o httpServer Express. Monta o namespace /copilot via
 *   mountCopilotNamespace. Onda 3.2 — L56.3.
 *
 *   src/copilot/server/socket/index.js
 */

import { log } from '#copilot/observability';
import { Server as SocketIOServer } from 'socket.io';
import { mountCopilotNamespace } from './hub-ns.js';

/**
 * @typedef {object} CopilotSocketOptions
 * @property {string | string[]} [cors] - Origem(ns) CORS para socket.io. Default: '*' (loopback)
 * @property {number} [pingTimeout] - Timeout de ping em ms. Default: 20000
 * @property {number} [pingInterval] - Intervalo de ping em ms. Default: 25000
 */

/**
 * @typedef {object} CopilotSocketResult
 * @property {SocketIOServer} io - Instância Socket.IO
 * @property {import('socket.io').Namespace} namespace - Namespace /copilot montado
 */

/**
 * Cria e configura o servidor Socket.IO sobre o httpServer.
 *
 * Monta o namespace `/copilot` com todos os handlers de eventos. Chamado após criação do httpServer em
 * `startCopilotServer()`.
 *
 * @param {import('node:http').Server} httpServer - Servidor HTTP Node.js
 * @param {import('../../conversation-hub/orchestrator.js').HubOrchestrator} orchestrator
 * @param {import('../../conversation-hub/store.js').ConversationStore} store
 * @param {CopilotSocketOptions} [opts]
 * @returns {CopilotSocketResult}
 */
export function createCopilotSocket(httpServer, orchestrator, store, opts) {
    const io = new SocketIOServer(httpServer, {
        cors: {
            // NEW-06: CORS wildcard seguro — bind em 127.0.0.1 (loopback only)
            origin: opts?.cors ?? '*',
            methods: ['GET', 'POST'],
        },
        pingTimeout: opts?.pingTimeout ?? 20_000,
        pingInterval: opts?.pingInterval ?? 25_000,
        // Transports: websocket first, polling fallback
        transports: ['websocket', 'polling'],
    });

    const namespace = mountCopilotNamespace(io, orchestrator, store);

    log('INFO', '[CopilotSocket] Socket.IO iniciado — namespace /copilot montado.');

    return { io, namespace };
}
