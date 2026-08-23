// @ts-check
/**
 * Narrow Agent → SDK session-runtime port.
 *
 * Agent internals outside `ports/` and `facades/` must not know the SDK session-runtime module topology. This seam keeps
 * the dependency directional while preserving the SDK-owned semantics of model switching.
 *
 * @module copilot/agent/ports/session-runtime-port
 */

import { setSessionModel } from '#copilot/sdk/session-runtime';

/**
 * @param {import('../types.js').CopilotSession} session
 * @param {string} modelId
 * @param {{reasoningEffort?: 'low'|'medium'|'high'|'xhigh'}} [options]
 * @returns {ReturnType<typeof setSessionModel>}
 */
export function setAgentSessionModel(session, modelId, options) {
    return setSessionModel(session, modelId, options);
}
