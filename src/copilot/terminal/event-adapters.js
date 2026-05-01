// @ts-check
/**
 * Suite canônica de adapters de eventos do terminal.
 *
 * Este é o ponto preferencial para conectar sinais do AlwaysAliveAgent à UX do terminal. O REPL interativo e o modo
 * headless usam o mesmo composition root, variando apenas a presença de `readline`.
 *
 * @module copilot/terminal/event-adapters
 */

import { getBusy } from '../presentation/runtime-ui-state-store.js';
import { setupTerminalAgentRuntimeEventListeners } from './agent-runtime-events.js';
import { buildUserPrompt } from './dialog/index.js';
import { readTerminalAgentRuntimeEventHost } from './frontend/llm-b-runtime.js';
import { setupTerminalSdkSessionEventListeners } from './sdk-session-events.js';

/**
 * @param {import('readline').Interface | null} rl
 * @returns {() => void}
 */
export function setupTerminalEventAdapters(rl = null) {
    const agent = readTerminalAgentRuntimeEventHost();
    const refreshPromptIfIdle = () => {
        if (!rl || getBusy()) return;
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

/**
 * @param {import('readline').Interface} rl
 * @returns {() => void}
 */
export function setupTerminalInteractiveEventAdapters(rl) {
    return setupTerminalEventAdapters(rl);
}

/**
 * @returns {() => void}
 */
export function setupTerminalHeadlessEventAdapters() {
    return setupTerminalEventAdapters(null);
}
