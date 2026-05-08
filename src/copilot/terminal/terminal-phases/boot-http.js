// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-http
 * @file Fase de boot: HTTP server.
 *
 *   Sobe o servidor Copilot HTTP/Socket com as opções de hub quando disponível, e faz teardown no rollback.
 */

import { isTerminalHubReady, readTerminalHubOrchestrator, readTerminalHubStore } from '../frontend/gateways/hub.js';
import { recordTerminalActivity } from '../state/activity-state.js';

/**
 * @param {import('../index.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalHttpServerPhase(ctx) {
    const hubReady = isTerminalHubReady();
    /** @type {import('../../server/index.js').CopilotServerOptions} */
    const serverOpts = {
        host: ctx.bootConfig.server.host,
        port: ctx.bootConfig.server.port,
    };
    if (ctx.bootConfig.server.token !== null) serverOpts.token = ctx.bootConfig.server.token;
    if (hubReady) {
        serverOpts.orchestrator = readTerminalHubOrchestrator();
        serverOpts.store = readTerminalHubStore();
    }
    recordTerminalActivity('boot', 'Subindo servidor copilot', { source: 'terminal', recordHistory: false });
    ctx.copilotServer = await ctx.startCopilotServer(serverOpts);
}

/**
 * Fecha o servidor HTTP do terminal.
 *
 * @param {import('../index.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function rollbackTerminalHttpServerPhase(ctx) {
    const server = ctx.copilotServer;
    ctx.copilotServer = null;
    if (server && typeof server.close === 'function') {
        await server.close();
    }
}
