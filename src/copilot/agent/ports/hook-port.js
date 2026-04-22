// @ts-check
/**
 * src/copilot/agent/ports/hook-port.js
 *
 * Porta compatível entre o runtime do agent e `hooks/`.
 *
 * @module copilot/agent/ports/hook-port
 * @internal
 */

import { attachBus, defaultBus } from '../../hooks/bus.js';
import { createHooks } from '../../hooks/factory.js';
import { createSessionHooks } from '../../hooks/session-hooks.js';

/**
 * @typedef {{
 *     emitWebhook: (event: string, payload: object) => Promise<void>;
 *     getModel: () => string | undefined;
 *     scheduleFallback: (model: string) => void;
 *     emit: (event: string, payload: object) => void;
 *     metrics: { recordSessionStart: () => void; recordSessionEnd: () => void };
 * }} AgentSessionHookInput
 */

/**
 * @param {AgentSessionHookInput} input
 * @returns {NonNullable<import('@github/copilot-sdk').SessionConfig['hooks']>}
 */
export function buildAgentBusHooks(input) {
    const lifecycleHooks = createSessionHooks(input);
    const hooks = createHooks({
        auditLog: true,
        onSessionStart: lifecycleHooks.onSessionStart,
        onSessionEnd: lifecycleHooks.onSessionEnd,
        onErrorOccurred: lifecycleHooks.onErrorOccurred,
    });

    return attachBus(hooks);
}

/**
 * @returns {typeof defaultBus}
 */
export function getDefaultHookBus() {
    return defaultBus;
}
