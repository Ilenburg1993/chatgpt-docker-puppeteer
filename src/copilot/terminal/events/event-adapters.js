// @ts-check
/**
 * Suite canônica de adapters de eventos do terminal.
 *
 * Este é o ponto preferencial para conectar sinais do AlwaysAliveAgent à UX do terminal. O REPL interativo e o modo
 * headless usam o mesmo composition root, variando apenas a presença de `readline`.
 *
 * @module copilot/terminal/event-adapters
 */

import { getBusy } from '../../presentation/state/index.js';
import { buildUserPrompt } from '../dialog/index.js';
import { readTerminalAgentRuntimeEventHost } from '../frontend/gateways/index.js';
import { createToolCallRegistry } from '../state/events/index.js';
import { setupTerminalAgentRuntimeEventListeners } from './agent-runtime-events.js';
import { setupTerminalIoActivityEvents } from './io-activity-events.js';
import { setupTerminalSdkSessionEventListeners } from './sdk-session-events.js';

/**
 * @param {import('readline').Interface | null} rl
 * @returns {() => void}
 */
export function setupTerminalEventAdapters(rl = null) {
    const agent = readTerminalAgentRuntimeEventHost();
    const registry = createToolCallRegistry();
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
    const cleanupIoActivityEvents = setupTerminalIoActivityEvents({ registry });

    return () => {
        cleanupAgentRuntimeEvents();
        cleanupSdkSessionEvents();
        cleanupIoActivityEvents();
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
