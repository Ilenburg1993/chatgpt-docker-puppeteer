// @ts-check
/**
 * @module copilot/agent/session/event-handlers/usage
 * F62.8: Handler dedicado para billing (assistant.usage).
 */

import { log } from '#copilot/observability/logger';
import { SESSION_EVENTS } from '#copilot/sdk';
import { writeStateAsync } from '../../lifecycle/state-io.js';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit' | 'onPrInfo'>} cb
 * @returns {() => void}
 */
export function wireUsageEvent(session, { emit, onPrInfo }) {
    return session.on(SESSION_EVENTS.ASSISTANT_USAGE, (/** @type {any} */ evt) => {
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
        void writeStateAsync(
            {
                pendingTurnConsumedPR: true,
                lastPrConsumedAt: Date.now(),
                lastPrModel: model ?? '',
                lastPrCost: cost ?? 0,
                lastQuotaSnapshots: quotaSnapshots ?? null,
            },
        );
    });
}
