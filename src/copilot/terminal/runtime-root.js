// @ts-check
/**
 * Composition root explícito do terminal permanente LLM-B.
 *
 * `index.js` permanece como barrel puro; toda a lógica de boot do terminal vive aqui.
 *
 * @module copilot/terminal/runtime-root
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { log } from '#copilot/observability';
import { startRepl } from './repl/index.js';
import { applyTerminalBootDisplayPreset, recordTerminalActivity } from './state/boot/index.js';
import { loadAliasesAsync } from './stores/index.js';
import {
    runTerminalConversationHubPhase,
    runTerminalHttpServerPhase,
    runTerminalPinnedContextPhase,
    runTerminalRuntimeListenersPhase,
} from './terminal-phases/index.js';

/**
 * @typedef {import('../server/index.js').CopilotServerOptions} TerminalCopilotServerOptions
 *
 * @typedef {import('../server/index.js').CopilotServer} TerminalCopilotServer
 *
 * @typedef {object} TerminalServerStartDeps
 * @property {(opts?: TerminalCopilotServerOptions) => Promise<TerminalCopilotServer>} startCopilotServer
 *
 * @typedef {object} TerminalServerStartOptions
 * @property {TerminalServerStartDeps['startCopilotServer']} [startCopilotServer]
 * @property {() => void} [wireRuntime]
 * @property {() => void | Promise<void>} [loadAliases]
 * @property {() => NodeJS.Timeout} [startTodoCleanupJob]
 * @property {ReturnType<import('#copilot/boot').readCopilotBootConfig>} [bootConfig]
 * @property {import('#copilot/agent/lifecycle').CopilotSdkBootPreflightReport | null} [bootPreflight]
 *
 *
 * @typedef {object} TerminalBootContext
 * @property {TerminalServerStartDeps['startCopilotServer']} startCopilotServer
 * @property {() => void} wireRuntime
 * @property {() => void | Promise<void>} loadAliases
 * @property {() => NodeJS.Timeout} startTodoCleanupJob
 * @property {ReturnType<import('#copilot/boot').readCopilotBootConfig>} bootConfig
 * @property {import('#copilot/agent/lifecycle').CopilotSdkBootPreflightReport | null} bootPreflight
 * @property {import('../config/pinned-files.js').PinnedFilesLoader | null} pinnedLoader
 * @property {(() => void) | null} disposePinnedBridge
 * @property {((evt: { file: string; type: string }) => void) | null} pinnedFilesChangedHandler
 * @property {((
 *           current: import('./state/index.js').TerminalActivitySnapshot,
 *           previous?: import('./state/index.js').TerminalActivitySnapshot,
 *       ) => void)
 *     | null} activityChangedHandler
 * @property {((
 *           activity: import('./state/index.js').TerminalActivitySnapshot,
 *           previous?: import('./state/index.js').TerminalActivitySnapshot,
 *       ) => void)
 *     | null} terminalActivityChangedHandler
 * @property {(() => void) | null} disposeIoActivityEvents
 * @property {TerminalCopilotServer | null} copilotServer
 * @property {NodeJS.Timeout | null} todoCleanupTimer
 */

/**
 * @param {TerminalServerStartOptions} [options]
 * @returns {TerminalBootContext}
 */
export function createTerminalBootContext(options = {}) {
    if (typeof options.startCopilotServer !== 'function') {
        throw new TypeError('[TerminalServer] startCopilotServer dependency is required by the composition root.');
    }
    if (typeof options.wireRuntime !== 'function') {
        throw new TypeError('[TerminalServer] wireRuntime dependency is required by the composition root.');
    }
    if (typeof options.startTodoCleanupJob !== 'function') {
        throw new TypeError('[TerminalServer] startTodoCleanupJob dependency is required by the composition root.');
    }
    const loadAliases = options.loadAliases ?? loadAliasesAsync;
    if (typeof loadAliases !== 'function') {
        throw new TypeError('[TerminalServer] loadAliases dependency is required by the composition root.');
    }

    return {
        startCopilotServer: options.startCopilotServer,
        wireRuntime: options.wireRuntime,
        loadAliases,
        startTodoCleanupJob: options.startTodoCleanupJob,
        bootConfig: options.bootConfig ?? readCopilotBootConfig(),
        bootPreflight: options.bootPreflight ?? null,
        pinnedLoader: null,
        disposePinnedBridge: null,
        pinnedFilesChangedHandler: null,
        activityChangedHandler: null,
        terminalActivityChangedHandler: null,
        disposeIoActivityEvents: null,
        copilotServer: null,
        todoCleanupTimer: null,
    };
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalInitPhase(ctx) {
    const displayPreset = applyTerminalBootDisplayPreset();
    recordTerminalActivity('boot', 'Inicializando terminal', {
        detail: `Preparando aliases, DI, hub e servidor HTTP · display=${displayPreset.name}`,
        source: 'terminal',
    });
    log('INFO', `[TerminalServer] Iniciando terminal permanente LLM-B (display=${displayPreset.name})…`);
    void ctx;
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalAliasesPhase(ctx) {
    recordTerminalActivity('boot', 'Carregando aliases', { source: 'terminal', recordHistory: false });
    await ctx.loadAliases();
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalRuntimeConfigPhase(ctx) {
    recordTerminalActivity('boot', 'Configurando runtime Copilot', { source: 'terminal', recordHistory: false });
    ctx.wireRuntime();
    if (ctx.bootPreflight) {
        recordTerminalActivity('boot', 'Executando preflight SDK', {
            detail: ctx.bootPreflight.pingOk ? 'CLI acessível' : 'CLI indisponível ou sem resposta',
            severity: ctx.bootPreflight.ok ? 'info' : 'warn',
            source: 'terminal',
            recordHistory: false,
        });
    }
}

/**
 * @param {TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalReplPhase(ctx) {
    if (!ctx.copilotServer) {
        throw new Error('[TerminalServer] copilot-http-server phase has not completed.');
    }
    await startRepl(ctx.copilotServer.httpServer);
}

/**
 * @param {TerminalServerStartOptions} [options]
 * @returns {Promise<void>}
 */
export async function startTerminalServer(options = {}) {
    const ctx = createTerminalBootContext(options);
    await runTerminalInitPhase(ctx);
    await runTerminalAliasesPhase(ctx);
    await runTerminalRuntimeConfigPhase(ctx);
    await runTerminalPinnedContextPhase(ctx);
    await runTerminalConversationHubPhase(ctx);
    await runTerminalHttpServerPhase(ctx);
    await runTerminalRuntimeListenersPhase(ctx);
    await runTerminalReplPhase(ctx);
}
