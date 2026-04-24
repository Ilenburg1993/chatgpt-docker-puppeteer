// @ts-check
/**
 * src/copilot/terminal/agent-sse-fallback.js
 *
 * Fallback genérico de SSE para eventos do agent ainda não tratados manualmente no terminal.
 *
 * @module copilot/terminal/agent-sse-fallback
 */

import { AGENT_EVENTS } from '#copilot/events';
import { broadcastSse } from './dialog/index.js';

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

/**
 * @param {{
 *     agent: AgentEventHost;
 *     handledEvents: Set<string>;
 * }} input
 * @returns {void}
 */
export function registerUnhandledAgentSseFallback({ agent, handledEvents }) {
    for (const evt of AGENT_EVENTS) {
        if (!handledEvents.has(evt)) {
            agent.on(evt, (/** @type {unknown} */ data) => {
                broadcastSse(evt, /** @type {object} */ (data ?? {}));
            });
        }
    }
}
