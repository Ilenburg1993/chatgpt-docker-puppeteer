// @ts-check
/**
 * @module copilot/agent/session/event-handlers/mode-and-tools
 * F62.5: Handler de eventos de mudança de modo e ferramentas.
 */

import { log } from '#copilot/observability/logger';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireModeAndToolEvents(session, { emit }) {
    return [
        session.on('session.mode_changed', (/** @type {any} */ evt) => {
            log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.['previousMode']} → ${evt?.data?.['newMode']}`);
            emit('session.mode_changed', evt?.data ?? {});
        }),
    ];
}
