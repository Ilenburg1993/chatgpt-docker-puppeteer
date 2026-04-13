// @ts-check
/**
 * @module copilot/server
 * @file Ponto de entrada do servidor copilot dedicado.
 *
 * Onda 3.0 — L54.7 (stub): exporta createCopilotServer com implementação pendente.
 * Onda 3.2 — L56.4: implementação completa com Express + Socket.IO.
 *
 * src/copilot/server/index.js
 */

import { LLM_B_TERMINAL_PORT } from '#copilot/config';
import { registerShutdownHandler } from '#copilot/core';
import { log } from '#copilot/observability';
import http from 'node:http';
import { createCopilotApp, registerErrorHandler } from './app.js';
import { mountCopilotRoutes } from './router.js';

/**
 * @typedef {object} CopilotServerOptions
 * @property {number} [port] - Porta de escuta. Default: LLM_B_TERMINAL_PORT (3009)
 * @property {string} [host] - Host de bind. Default: '127.0.0.1' (loopback only)
 * @property {string} [token] - Token bearer override
 * @property {boolean} [skipAuth] - Desabilitar auth (test)
 */

/**
 * @typedef {object} CopilotServer
 * @property {http.Server} httpServer - Servidor HTTP Node.js
 * @property {import('express').Application} app - App Express
 * @property {number} port - Porta em uso
 * @property {() => Promise<void>} close - Para o servidor graciosamente
 */

/**
 * Cria e inicia o servidor copilot dedicado (Express + Socket.IO).
 *
 * STUB — Onda 3.0: Express app criado mas rotas não montadas ainda.
 * Onda 3.1 monta as rotas. Onda 3.2 adiciona Socket.IO e completa.
 *
 * O terminal/server.js (createInjectServer) continua sendo o servidor ativo
 * até a Onda 3.3 quando terminal/index.js é migrado para usar startCopilotServer().
 *
 * @param {CopilotServerOptions} [opts]
 * @returns {Promise<CopilotServer>}
 */
export async function startCopilotServer(opts) {
    const port = opts?.port ?? LLM_B_TERMINAL_PORT;
    const host = opts?.host ?? '127.0.0.1';

    /** @type {import('./app.js').CopilotAppOptions} */
    const appOpts = {};
    if (opts?.token !== undefined) appOpts.token = opts.token;
    if (opts?.skipAuth !== undefined) appOpts.skipAuth = opts.skipAuth;
    const app = createCopilotApp(appOpts);

    // Onda 3.1: montar todas as rotas copilot
    mountCopilotRoutes(app, { token: opts?.token });

    // Onda 3.2: createCopilotSocket(httpServer) será chamado aqui

    // Error handler deve ser registrado APÓS rotas
    registerErrorHandler(app);

    const httpServer = http.createServer(app);

    await new Promise((resolve, reject) => {
        httpServer.listen(port, host, () => resolve(undefined));
        httpServer.once('error', reject);
    });

    log('INFO', `[CopilotServer] Servidor iniciado em http://${host}:${port}`);

    // Graceful shutdown
    registerShutdownHandler('copilot.server', async () => {
        await new Promise((resolve) => httpServer.close(resolve));
        log('INFO', '[CopilotServer] Servidor encerrado.');
    });

    return {
        httpServer,
        app,
        port,
        close: () =>
            new Promise((resolve) => {
                httpServer.close(() => resolve());
            }),
    };
}
