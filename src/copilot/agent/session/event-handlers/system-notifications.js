// @ts-check
/**
 * @module copilot/agent/session/event-handlers/system-notifications
 * F62.6: Handler de eventos system.notification da sessão SDK.
 */

import { log } from '#copilot/observability/logger';

/**
 * @param {import('../event-wirer.js').CopilotSessionLike} session
 * @param {Pick<import('../event-wirer.js').SessionWirerCallbacks, 'emit'>} cb
 * @returns {(() => void)[]}
 */
export function wireSystemNotificationEvents(session, { emit }) {
    return [
        session.on('system.notification', (/** @type {any} */ event) => {
            const kind = /** @type {Record<string, unknown> & { type: string }} */ (event?.data?.['kind']);
            if (!kind?.type) return;

            switch (kind.type) {
                case 'agent_completed':
                    emit('agent.background.completed', {
                        agentId: kind['agentId'],
                        agentType: kind['agentType'],
                        status: kind['status'],
                        description: kind['description'],
                    });
                    log(
                        'INFO',
                        `[session-event-wirer] system.notification agent_completed: agentId=${kind['agentId']} status=${kind['status']}`,
                    );
                    break;
                case 'agent_idle':
                    emit('agent.background.idle', {
                        agentId: kind['agentId'],
                        agentType: kind['agentType'],
                        description: kind['description'],
                    });
                    log('DEBUG', `[session-event-wirer] system.notification agent_idle: agentId=${kind['agentId']}`);
                    break;
                case 'shell_completed':
                    emit('agent.shell.completed', {
                        shellId: kind['shellId'],
                        exitCode: kind['exitCode'],
                        description: kind['description'],
                    });
                    log(
                        'DEBUG',
                        `[session-event-wirer] system.notification shell_completed: shellId=${kind['shellId']} exitCode=${kind['exitCode'] ?? '?'}`,
                    );
                    break;
                case 'shell_detached_completed':
                    emit('agent.shell.detached_completed', {
                        shellId: kind['shellId'],
                        description: kind['description'],
                    });
                    log(
                        'DEBUG',
                        `[session-event-wirer] system.notification shell_detached_completed: shellId=${kind['shellId']}`,
                    );
                    break;
                default:
                    break;
            }
        }),
    ];
}
