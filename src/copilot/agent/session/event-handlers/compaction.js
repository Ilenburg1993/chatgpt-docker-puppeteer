// @ts-check
/**
 * @module copilot/agent/session/event-handlers/compaction
 * F62.2: Handler de eventos de compaction da sessão SDK.
 */

import { log } from '#copilot/observability/logger';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<
 *     import('../event-wirer.js').SessionWirerCallbacks,
 *     'emit' | 'getStatusSnapshot' | 'onCheckpointPath'
 * >} cb
 * @returns {(() => void)[]}
 */
export function wireCompactionEvents(session, { emit, getStatusSnapshot, onCheckpointPath }) {
    return [
        session.on('session.compaction_start', (/** @type {any} */ evt) => {
            log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
            emit('session.compaction_start', evt?.data ?? {});
        }),
        session.on('session.compaction_complete', (/** @type {any} */ evt) => {
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
