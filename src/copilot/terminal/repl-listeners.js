// @ts-check
/**
 * src/copilot/terminal/repl-listeners.js
 *
 * Listeners de eventos do AlwaysAliveAgent para exibição no terminal REPL. Extraído de repl.js (F103) para reduzir
 * complexidade.
 *
 * @module copilot/terminal/repl-listeners
 * @see EventBus
 */

import { setupTerminalAgentRuntimeEventListeners } from './agent-runtime-events.js';
import { buildUserPrompt } from './dialog.js';
import { getTerminalAgentRuntime } from './frontend/llm-b-runtime.js';
import { setupTerminalSdkSessionEventListeners } from './sdk-session-events.js';
import { getBusy } from './state.js';

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {import('readline').Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
export function setupAgentListeners(rl) {
    const agent = getTerminalAgentRuntime();
    const refreshPromptIfIdle = () => {
        if (getBusy()) return;
        rl.setPrompt(buildUserPrompt());
        rl.prompt();
    };
    const cleanupAgentRuntimeEvents = setupTerminalAgentRuntimeEventListeners({ agent, rl });
    const cleanupSdkSessionEvents = setupTerminalSdkSessionEventListeners({
        agent,
        refreshPromptIfIdle,
    });

    return () => {
        cleanupAgentRuntimeEvents();
        cleanupSdkSessionEvents();
    };
}
