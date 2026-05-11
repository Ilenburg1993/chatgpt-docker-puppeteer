// @ts-check
/**
 * @module copilot/terminal/repl
 * @file Composition root do REPL terminal LLM-B.
 *
 *   src/copilot/terminal/repl/repl.js
 *
 *   Responsabilidades:
 *
 *   - Exportar `startRepl` (ponto de entrada do lifecycle do REPL)
 *   - Exportar `launchTerminalDialogLoopBootstrap` (bootstrap assíncrono do dialog loop)
 *   - Delegar o routing de comandos para `repl-command-router.js`
 *   - Delegar o lifecycle readline para `repl-lifecycle.js`
 *
 * @see EventBus
 * @see module:copilot/always-alive
 * @see module:copilot/terminal/dialog
 * @see module:copilot/terminal/repl-command-router
 * @see module:copilot/terminal/repl-lifecycle
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { toError } from '#copilot/core';
import { log } from '#copilot/observability';
import { ensureDialogLoop, println } from '../dialog/index.js';
import { setupTerminalHeadlessEventAdapters } from '../events/event-adapters.js';
import { recordTerminalActivity } from '../state/activity-state.js';
import { runReplLifecycle } from './repl-lifecycle.js';
export { setupAgentListeners } from './repl-listeners.js';

/** @type {number} */
const INJECT_PORT = readCopilotBootConfig().server.port;

/**
 * Dispara o bootstrap do dialog loop sem prender o lifecycle do REPL.
 *
 * O REPL/HTTP são hosts permanentes; o primeiro READY do agent pode demorar por resume, sync de sessão, skills ou
 * latência do SDK. Essa tarefa é observável, mas não é pré-condição para considerar a fase `repl` iniciada.
 *
 * @param {{
 *     ensureDialogLoopFn?: () => Promise<void>;
 *     printlnFn?: (line: string) => void;
 *     logFn?: typeof log;
 * }} [deps]
 * @returns {Promise<void>}
 */
export function launchTerminalDialogLoopBootstrap(deps = {}) {
    const ensureDialogLoopFn = deps.ensureDialogLoopFn ?? ensureDialogLoop;
    const printlnFn = deps.printlnFn ?? println;
    const logFn = deps.logFn ?? log;

    recordTerminalActivity('boot', 'Inicializando dialog loop', {
        detail: 'Bootstrap assíncrono do protocolo READY/REPLY',
        source: 'terminal',
        recordHistory: false,
    });

    return Promise.resolve()
        .then(() => ensureDialogLoopFn())
        .catch((e) => {
            const error = toError(e);
            recordTerminalActivity('error', 'Falha no bootstrap do dialog loop', {
                detail: error.message,
                source: 'terminal',
                severity: 'error',
            });
            printlnFn(`\x1b[31m  [erro de boot] ${error.message}\x1b[0m`);
            logFn('ERROR', `[TerminalServer] Dialog loop bootstrap error: ${error.message}`);
        });
}

/**
 * Inicia o REPL readline do terminal permanente.
 *
 * Em modo headless (stdin não-TTY), dispara o dialog loop em background e retorna, deixando o inject server HTTP manter
 * o event loop ativo.
 *
 * @param {import('node:http').Server} injectServer - Servidor HTTP de injeção (para fechar no /quit)
 * @returns {Promise<void>}
 */
export async function startRepl(injectServer) {
    if (!process.stdin.isTTY) {
        println('[boot] Modo headless detectado — REPL desativado. Use POST :' + INJECT_PORT + '/inject.');
        setupTerminalHeadlessEventAdapters();
        void launchTerminalDialogLoopBootstrap();
        return;
    }

    await runReplLifecycle(injectServer, {
        injectPort: INJECT_PORT,
        onReady: () => void launchTerminalDialogLoopBootstrap(),
    });
}
