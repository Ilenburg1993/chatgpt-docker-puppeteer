// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-http
 * @file Fase de boot: HTTP server.
 *
 *   Sobe o servidor Copilot HTTP/Socket com as opções de hub quando disponível, e faz teardown no rollback.
 */

import { isTerminalHubReady, readTerminalHubOrchestrator, readTerminalHubStore } from '../frontend/gateways/index.js';
import { recordTerminalActivity } from '../state/boot/index.js';

const TERMINAL_PORT_FALLBACK_SCAN_LIMIT = 20;

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isAddressInUseError(error) {
    return error instanceof Error && /** @type {{ code?: unknown }} */ (error).code === 'EADDRINUSE';
}

/**
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @param {import('../../server/index.js').CopilotServerOptions} serverOpts
 * @returns {Promise<import('../runtime-root.js').TerminalCopilotServer>}
 */
async function startTerminalCopilotServerWithPortPolicy(ctx, serverOpts) {
    const preferredPort = Number(serverOpts.port ?? ctx.bootConfig.server.port);
    const strict = process.env['LLM_B_TERMINAL_PORT_STRICT'] === 'true';
    const maxAttempts = strict || preferredPort === 0 ? 1 : TERMINAL_PORT_FALLBACK_SCAN_LIMIT + 1;
    /** @type {unknown} */
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const port = preferredPort === 0 ? 0 : preferredPort + attempt;
        try {
            return await ctx.startCopilotServer({ ...serverOpts, port });
        } catch (error) {
            if (!isAddressInUseError(error)) throw error;
            lastError = error;
            recordTerminalActivity('boot', 'Porta do inject server ocupada', {
                detail: `porta=${port}${strict ? ' · strict=true' : ' · tentando próxima porta'}`,
                severity: 'warn',
                source: 'terminal',
                recordHistory: false,
            });
            if (strict) throw error;
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error(`[TerminalServer] Nenhuma porta livre encontrada a partir de ${preferredPort}.`);
}

/**
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
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
    ctx.copilotServer = await startTerminalCopilotServerWithPortPolicy(ctx, serverOpts);
    if (ctx.copilotServer.port !== serverOpts.port) {
        recordTerminalActivity('boot', 'Inject server realocado', {
            detail: `${serverOpts.port} -> ${ctx.copilotServer.port}`,
            severity: 'warn',
            source: 'terminal',
            recordHistory: false,
        });
    }
}

/**
 * Fecha o servidor HTTP do terminal.
 *
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function rollbackTerminalHttpServerPhase(ctx) {
    const server = ctx.copilotServer;
    ctx.copilotServer = null;
    if (server && typeof server.close === 'function') {
        await server.close();
    }
}
