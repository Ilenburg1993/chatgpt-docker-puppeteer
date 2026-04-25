// @ts-check
/**
 * @module copilot/event-handlers/usage
 * @see EventBus
 * F62.8: Handler dedicado para billing (assistant.usage).
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '../sdk/session/events.js';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit' | 'onPrInfo'>} cb
 * @returns {() => void}
 */
export function wireUsageEvent(session, { emit, onPrInfo }) {
    return onSessionEvent(session, SESSION_EVENTS.ASSISTANT_USAGE, (evt) => {
        const data = evt?.data ?? {};
        const model = /** @type {string | undefined} */ (data['model']);
        const cost = /** @type {number | undefined} */ (data['cost']);
        const quotaSnapshots = /** @type {Record<string, unknown> | undefined} */ (data['quotaSnapshots']);
        const prInfo = {
            ts: Date.now(),
            ...(model !== undefined ? { model } : {}),
            ...(cost !== undefined ? { cost } : {}),
            ...(quotaSnapshots !== undefined ? { quotaSnapshots } : {}),
        };
        log('INFO', `[AlwaysAlive] PR consumido: model=${model ?? '?'}, cost=${cost ?? '?'}`);
        onPrInfo(prInfo);
        emit('pr.consumed', prInfo);
    });
}
