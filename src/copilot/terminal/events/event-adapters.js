// @ts-check
/**
 * Suite canônica de adapters de eventos do terminal.
 *
 * Este é o ponto preferencial para conectar sinais do AlwaysAliveAgent à UX do terminal. O REPL interativo e o modo
 * headless usam o mesmo composition root, variando apenas a presença de `readline`.
 *
 * @module copilot/terminal/event-adapters
 */

import { getBusy } from '../../presentation/runtime-ui-state-store.js';
import { buildUserPrompt } from '../dialog/index.js';
import { readTerminalAgentRuntimeEventHost } from '../frontend/gateways/agent-runtime.js';
import { clearActiveToolCallRegistry, setActiveToolCallRegistry } from '../state/active-tool-call-registry.js';
import { createToolCallRegistry } from '../state/tool-call-registry.js';
import { setupTerminalAgentRuntimeEventListeners } from './agent-runtime-events.js';
import { setupTerminalSdkSessionEventListeners } from './sdk-session-events.js';

/**
 * @param {import('readline').Interface | null} rl
 * @returns {() => void}
 */
export function setupTerminalEventAdapters(rl = null) {
    const agent = readTerminalAgentRuntimeEventHost();
    const registry = createToolCallRegistry();
    setActiveToolCallRegistry(registry);
    const refreshPromptIfIdle = () => {
        if (!rl || getBusy()) return;
        rl.setPrompt(buildUserPrompt());
        rl.prompt();
    };
    const cleanupAgentRuntimeEvents = setupTerminalAgentRuntimeEventListeners({ agent, rl, registry });
    const cleanupSdkSessionEvents = setupTerminalSdkSessionEventListeners({
        agent,
        refreshPromptIfIdle,
        registry,
    });

    return () => {
        cleanupAgentRuntimeEvents();
        cleanupSdkSessionEvents();
        clearActiveToolCallRegistry();
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
