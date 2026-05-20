// @ts-check
/**
 * src/copilot/terminal/events/agent-sse-passthrough.js
 *
 * Passthrough SSE explícito e estreito para eventos do agent ainda sem adapter dedicado no terminal.
 *
 * @module copilot/terminal/agent-sse-passthrough
 */

import { AGENT_EVENTS } from '#copilot/events';
import { broadcastSse } from '../dialog/index.js';
import { withTerminalTurnCorrelation } from '../state/events/index.js';

/**
 * @typedef {{
 *     on: (event: string, handler: (...args: any[]) => void) => void;
 * }} AgentEventHost
 */

/**
 * @param {{
 *     agent: AgentEventHost;
 *     handledEvents: Set<string>;
 *     passthroughEvents: Set<string>;
 * }} input
 * @returns {void}
 */
export function registerTerminalAgentSsePassthrough({ agent, handledEvents, passthroughEvents }) {
    for (const evt of AGENT_EVENTS) {
        if (handledEvents.has(evt) || !passthroughEvents.has(evt)) {
            continue;
        }
        agent.on(evt, (/** @type {unknown} */ data) => {
            broadcastSse(
                evt,
                withTerminalTurnCorrelation({
                    ...(data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}),
                    source: `agent/passthrough/${evt}`,
                    timestamp: Date.now(),
                }),
            );
        });
    }
}
