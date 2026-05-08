// @ts-check
/**
 * src/copilot/terminal/index.js
 *
 * Ponto de entrada do Terminal Permanente LLM-B.
 *
 * Orquestra a inicialização sequencial de todos os subsistemas:
 *
 * 1. Carrega aliases customizados
 * 2. Configura o runtime Copilot
 * 3. Carrega arquivos de contexto pinados
 * 4. Cria hub_session no ConversationStore (best-effort)
 * 5. Sobe o servidor HTTP/Socket
 * 6. Registra watchdogs e listeners de eventos do AlwaysAliveAgent
 * 7. Ativa o reflection loop periódico (se configurado)
 * 8. Inicia o REPL readline (via `repl.js`)
 *
 * @module copilot/terminal
 * @see EventBus
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { log } from '#copilot/observability';
import { recordTerminalActivity } from './activity-state.js';
import { loadAliasesAsync } from './alias-store.js';
import { applyTerminalBootDisplayPreset } from './display-policy.js';
import { startRepl } from './repl.js';
import { runTerminalHttpServerPhase } from './terminal-phases/boot-http.js';
import { runTerminalConversationHubPhase } from './terminal-phases/boot-hub.js';
import { runTerminalRuntimeListenersPhase } from './terminal-phases/boot-listeners.js';
import { runTerminalPinnedContextPhase } from './terminal-phases/boot-pinned.js';

export {
    buildTerminalModuleScorecard,
    getTerminalModuleDescriptor,
    getTerminalModuleRole,
    listTerminalModulesByRisk,
    listTerminalModulesByRole,
    TERMINAL_MODULE_LAYOUT,
} from './module-map.js';

// Re-export das fases decompostas para consumidores que usam importação explícita
export { printStandaloneBanner } from './terminal-phases/boot-banner.js';
export { rollbackTerminalHttpServerPhase, runTerminalHttpServerPhase } from './terminal-phases/boot-http.js';
export { runTerminalConversationHubPhase } from './terminal-phases/boot-hub.js';
export {
    rollbackTerminalRuntimeListenersPhase,
    runTerminalRuntimeListenersPhase,
} from './terminal-phases/boot-listeners.js';
export { rollbackTerminalPinnedContextPhase, runTerminalPinnedContextPhase } from './terminal-phases/boot-pinned.js';
export { startReflectionLoop, stopReflectionLoop } from './terminal-phases/boot-reflection-loop.js';

// T-20: estado do reflection timer migrado para terminal-phases/boot-listeners.js

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
 * @property {() => NodeJS.Timeout} [startTodoCleanupJob]
 * @property {ReturnType<import('#copilot/boot').readCopilotBootConfig>} [bootConfig]
 * @property {import('../agent/lifecycle/process-host/runtime-host.js').CopilotSdkBootPreflightReport} [bootPreflight]
 *
 * @typedef {object} TerminalBootContext
 * @property {TerminalServerStartDeps['startCopilotServer']} startCopilotServer
 * @property {() => void} wireRuntime
 * @property {() => NodeJS.Timeout} startTodoCleanupJob
 * @property {ReturnType<import('#copilot/boot').readCopilotBootConfig>} bootConfig
 * @property {import('../agent/lifecycle/process-host/runtime-host.js').CopilotSdkBootPreflightReport | null} bootPreflight
 * @property {import('../config/pinned-files.js').PinnedFilesLoader | null} pinnedLoader
 * @property {(() => void) | null} disposePinnedBridge
 * @property {((evt: { file: string; type: string }) => void) | null} pinnedFilesChangedHandler
 * @property {((
 *           current: import('./activity-state.js').TerminalActivitySnapshot,
 *           previous?: import('./activity-state.js').TerminalActivitySnapshot,
 *       ) => void)
 *     | null} activityChangedHandler
 * @property {((
 *           activity: import('./activity-state.js').TerminalActivitySnapshot,
 *           previous?: import('./activity-state.js').TerminalActivitySnapshot,
 *       ) => void)
 *     | null} terminalActivityChangedHandler
 * @property {(() => void) | null} disposeIoActivityEvents
 * @property {TerminalCopilotServer | null} copilotServer
 * @property {NodeJS.Timeout | null} todoCleanupTimer
 */

/**
 * Cria o contexto transacional das fases do terminal. Nenhum recurso externo é alocado aqui.
 *
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
    return {
        startCopilotServer: options.startCopilotServer,
        wireRuntime: options.wireRuntime,
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

// ---------------------------------------------------------------------------
// Fases triviais (lógica mínima — ficam no orchestrator)
// ---------------------------------------------------------------------------

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
    await loadAliasesAsync();
    void ctx;
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

// ---------------------------------------------------------------------------
// Orchestrator principal
// ---------------------------------------------------------------------------

/**
 * Inicia o Terminal Permanente LLM-B.
 *
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
