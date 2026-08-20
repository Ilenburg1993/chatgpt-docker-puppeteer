// @ts-check
/**
 * @module copilot/server
 * @file Owner do servidor HTTP/Socket.IO do Copilot local.
 *
 *   Onda 3.0 — L54.7: Express app + middleware criados. Onda 3.1 — L55.8: mountCopilotRoutes integrado. Onda 3.2 — L56.4:
 *   implementação completa com Express + Socket.IO.
 *
 *   src/copilot/server/index.js
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { registerShutdownHandler, SHUTDOWN_PRIORITY } from '#copilot/core';
import { log } from '#copilot/observability';
import http from 'node:http';
import { createCopilotApp, registerErrorHandler } from './app.js';
import { mountCopilotRoutes } from './router.js';
import { createCopilotSocket } from './socket/index.js';

export {
    getServerModuleDescriptor,
    getServerModuleRole,
    listServerModulesByRole,
    SERVER_MODULE_LAYOUT,
} from './module-map.js';
export {
    buildServerRouteModuleScorecard,
    getServerRouteModuleDescriptor,
    getServerRouteModuleRole,
    listServerRouteModulesByRisk,
    listServerRouteModulesByRole,
    listServerRouteModulesBySurface,
    SERVER_ROUTE_MODULE_LAYOUT,
} from './routes/module-map.js';

/**
 * @typedef {object} CopilotServerOptions
 * @property {number} [port] - Porta de escuta. Default: LLM_B_TERMINAL_PORT (3009)
 * @property {string} [host] - Host de bind. Default: '127.0.0.1' (loopback only)
 * @property {string} [token] - Token bearer override
 * @property {boolean} [skipAuth] - Desabilitar auth (test)
 * @property {import('../conversation-hub/orchestrator.js').HubOrchestrator} [orchestrator] - Orchestrator do hub
 * @property {import('../conversation-hub/store.js').ConversationStore} [store] - Store do hub
 * @property {boolean} [withSocket] - Se true, inicializa Socket.IO. Default: true se orchestrator fornecido
 */

/**
 * @typedef {object} CopilotServer
 * @property {http.Server} httpServer - Servidor HTTP Node.js
 * @property {import('express').Application} app - App Express
 * @property {import('socket.io').Server | null} io - Socket.IO server (null se withSocket=false)
 * @property {string} host - Host efetivo em uso
 * @property {number} port - Porta em uso
 * @property {string} url - URL efetiva do servidor
 * @property {() => Promise<void>} close - Para o servidor graciosamente
 */

/**
 * Cria e inicia o servidor copilot dedicado (Express + Socket.IO).
 *
 * Este módulo não inicia REPL, terminal UX nem runtime agent. Ele é composto pelo boot canônico do terminal, que injeta
 * `startCopilotServer()` no host local.
 *
 * @param {CopilotServerOptions} [opts]
 * @returns {Promise<CopilotServer>}
 */
export async function startCopilotServer(opts) {
    const bootConfig = readCopilotBootConfig();
    const port = opts?.port ?? bootConfig.server.port;
    const host = opts?.host ?? bootConfig.server.host;

    /** @type {import('./app.js').CopilotAppOptions} */
    const appOpts = {};
    if (opts?.token !== undefined) appOpts.token = opts.token;
    if (opts?.skipAuth !== undefined) appOpts.skipAuth = opts.skipAuth;
    const app = createCopilotApp(appOpts);

    // Onda 3.1: montar todas as rotas copilot
    mountCopilotRoutes(app, opts?.token === undefined ? {} : { token: opts.token });

    // Error handler deve ser registrado APÓS rotas
    registerErrorHandler(app);

    const httpServer = http.createServer(app);

    // Onda 3.2: Socket.IO — só monta se orchestrator/store foram fornecidos
    const withSocket = opts?.withSocket ?? (!!opts?.orchestrator && !!opts?.store);
    /** @type {import('socket.io').Server | null} */
    let io = null;

    if (withSocket && opts?.orchestrator && opts?.store) {
        const socketResult = createCopilotSocket(httpServer, opts.orchestrator, opts.store);
        io = socketResult.io;
    }

    await new Promise((resolve, reject) => {
        /** @param {Error} error */
        const onError = (error) => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(port, host, () => {
            httpServer.off('error', onError);
            resolve(undefined);
        });
    });

    const address = httpServer.address();
    const effectivePort =
        address && typeof address === 'object' && typeof address.port === 'number' ? address.port : port;
    log('INFO', `[CopilotServer] Servidor iniciado em http://${host}:${effectivePort}${io ? ' + socket.io' : ''}`);

    /** @type {Promise<void> | null} */
    let closeInFlight = null;

    // Graceful shutdown
    registerShutdownHandler(
        'copilot.server',
        async () => {
            await closeServer();
        },
        SHUTDOWN_PRIORITY.NETWORK,
    );

    /**
     * Fecha o servidor de forma idempotente.
     *
     * @returns {Promise<void>}
     */
    function closeServer() {
        if (closeInFlight) {
            return closeInFlight;
        }
        closeInFlight = (async () => {
            if (io) {
                await new Promise((resolve) => io.close(() => resolve(undefined)));
            }
            await new Promise((resolve, reject) => {
                httpServer.close((error) => {
                    if (error && /** @type {{ code?: string }} */ (error).code !== 'ERR_SERVER_NOT_RUNNING') {
                        reject(error);
                        return;
                    }
                    resolve(undefined);
                });
            });
            log('INFO', '[CopilotServer] Servidor encerrado.');
        })();
        return closeInFlight;
    }

    return {
        httpServer,
        app,
        io,
        host,
        port: effectivePort,
        url: `http://${host}:${effectivePort}`,
        close: closeServer,
    };
}
