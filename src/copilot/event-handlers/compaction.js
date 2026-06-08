// @ts-check
/**
 * @module copilot/event-handlers/compaction
 * @see EventBus
 * F62.2: Handler de eventos de compaction da sessão SDK.
 */

import { SESSION_EVENTS } from '#copilot/events';
import { log } from '#copilot/observability';
import { onSessionEvent } from '#copilot/events/sdk-events';

/**
 * @param {import('./contracts.js').CopilotSessionLike} session
 * @param {Pick<
 *     import('./contracts.js').SessionWirerCallbacks,
 *     'emit' | 'getStatusSnapshot' | 'onCheckpointPath'
 * >} cb
 * @returns {(() => void)[]}
 */
export function wireCompactionEvents(session, { emit, getStatusSnapshot, onCheckpointPath }) {
    return [
        onSessionEvent(session, SESSION_EVENTS.SESSION_COMPACTION_START, (evt) => {
            log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
            emit('session.compaction_start', evt?.data ?? {});
        }),
        onSessionEvent(session, SESSION_EVENTS.SESSION_COMPACTION_COMPLETE, (evt) => {
            const data = /** @type {{ success?: boolean; checkpointPath?: string }} */ (evt?.data ?? {});
            if (data['success'] === false) {
                log('ERROR', '[AlwaysAlive] Compaction falhou. Sessão pode estar instável.');
                if (data['checkpointPath']) {
                    log(
                        'WARN',
                        `[AlwaysAlive] Checkpoint disponível: ${data['checkpointPath']}. Para recovery manual, restaure esse arquivo e reinicie.`,
                    );
                }
            } else {
                log('INFO', '[AlwaysAlive] Compaction concluída.');
            }
            if (data['checkpointPath']) {
                onCheckpointPath(data['checkpointPath']);
            }
            emit('session.compaction_complete', data);
            const snap = getStatusSnapshot();
            emit('context:compacted', {
                sessionId: snap?.sessionId ?? null,
                ts: Date.now(),
                checkpoint: data['checkpointPath'] ?? null,
            });
        }),
    ];
}
