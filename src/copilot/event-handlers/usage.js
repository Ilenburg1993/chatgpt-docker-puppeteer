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
 * @param {import('#copilot/agent/session/wiring/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/wiring/event-wirer').SessionWirerCallbacks, 'emit' | 'onPrInfo'>} cb
 * @returns {() => void}
 */
export function wireUsageEvent(session, { emit, onPrInfo }) {
    return onSessionEvent(session, SESSION_EVENTS.ASSISTANT_USAGE, (evt) => {
        const data = evt?.data ?? {};
        const billedModel = /** @type {string | undefined} */ (data['model']);
        const cost = /** @type {number | undefined} */ (data['cost']);
        const quotaSnapshots = /** @type {Record<string, unknown> | undefined} */ (data['quotaSnapshots']);
        const sessionRecord = /** @type {{ model?: unknown; config?: { model?: unknown }; sessionId?: unknown }} */ (
            session
        );
        const configuredModel =
            typeof sessionRecord.model === 'string'
                ? sessionRecord.model
                : typeof sessionRecord.config?.model === 'string'
                  ? sessionRecord.config.model
                  : undefined;
        const modelMismatch = Boolean(billedModel && configuredModel && billedModel !== configuredModel);
        const prInfo = {
            ts: Date.now(),
            ...(billedModel !== undefined ? { model: billedModel } : {}),
            ...(configuredModel !== undefined ? { configuredModel } : {}),
            ...(modelMismatch ? { modelMismatch } : {}),
            sessionId: typeof sessionRecord.sessionId === 'string' ? sessionRecord.sessionId : null,
            ...(cost !== undefined ? { cost } : {}),
            ...(quotaSnapshots !== undefined ? { quotaSnapshots } : {}),
        };
        log(
            'INFO',
            `[AlwaysAlive] PR consumido: billedModel=${billedModel ?? '?'} configuredModel=${configuredModel ?? '?'} cost=${cost ?? '?'}${modelMismatch ? ' [MODEL_MISMATCH]' : ''}`,
        );
        onPrInfo(prInfo);
        emit('pr.consumed', prInfo);
    });
}
