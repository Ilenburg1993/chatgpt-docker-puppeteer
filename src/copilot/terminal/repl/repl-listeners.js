// @ts-check
/**
 * src/copilot/terminal/repl/repl-listeners.js
 *
 * Listeners de eventos do AlwaysAliveAgent para exibição no terminal REPL. Extraído de repl.js (F103) para reduzir
 * complexidade.
 *
 * @module copilot/terminal/repl-listeners
 * @see EventBus
 */

import { setupTerminalInteractiveEventAdapters } from '../events/index.js';

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {import('readline').Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
export function setupAgentListeners(rl) {
    return setupTerminalInteractiveEventAdapters(rl);
}
