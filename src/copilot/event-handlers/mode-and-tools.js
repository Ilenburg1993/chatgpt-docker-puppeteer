// @ts-check
/**
 * @module copilot/event-handlers/mode-and-tools
 * @see EventBus
 * F62.5: Handler de eventos de mudança de modo e ferramentas.
 */

import { log } from '#copilot/observability';
import { SESSION_EVENTS } from '#copilot/sdk';

/**
 * @param {import('#copilot/agent/session/event-wirer').CopilotSessionLike} session
 * @param {Pick<import('#copilot/agent/session/event-wirer').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireModeAndToolEvents(session, { emit }) {
    return [
        session.on(SESSION_EVENTS.SESSION_MODE_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const previousMode = /** @type {string | undefined} */ (data['previousMode']);
            const newMode = /** @type {string | undefined} */ (data['newMode']);
            log('INFO', `[AlwaysAlive] Modo mudou: ${previousMode ?? '?'} → ${newMode ?? '?'}`);
            emit('session.mode_changed', {
                previousMode,
                newMode,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),
        session.on(SESSION_EVENTS.SESSION_PLAN_CHANGED, (evt) => {
            const data = /** @type {Record<string, unknown>} */ (evt?.data ?? {});
            const operation = /** @type {'create' | 'update' | 'delete' | undefined} */ (data['operation']);
            log('INFO', `[AlwaysAlive] Plano da sessão mudou: ${operation ?? '?'}`);
            emit('session.plan_changed', {
                operation,
                ts: evt?.timestamp ?? Date.now(),
            });
        }),
    ];
}
