// @ts-check
/**
 * src/copilot/observability/bus-actions/activity-tracker.js — FAIXA-L15
 *
 * EventBus subscriber que rastreia timestamp da última atividade por tipo, permitindo detecção de deadlock/inatividade
 * pelo watchdog.
 *
 * @module copilot/observability/bus-actions/activity-tracker
 */

import { log } from '../logger.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 */

/**
 * @typedef {object} ActivitySnapshot
 * @property {number} lastActivity - timestamp ms da última atividade
 * @property {string} lastEventType - tipo do último evento recebido
 * @property {number} eventCount - total de eventos rastreados
 * @property {number} idleMs - ms desde a última atividade
 */

/**
 * @param {{ bus: EventBus; trackTypes?: string[] }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string; getSnapshot: () => ActivitySnapshot }}
 */
export function createActivityTracker({ bus, trackTypes }) {
    let lastActivity = Date.now();
    let lastEventType = 'init';
    let eventCount = 0;
    /** @type {(() => void)[]} */
    const unsubs = [];

    const types = trackTypes ?? [
        'agent:dialog:turn_start',
        'agent:dialog:turn_end',
        'agent:task:started',
        'agent:task:completed',
        'agent:dialog:ready',
        'agent:ready',
        'hook:pre_tool_use',
        'hook:post_tool_use',
        'agent:session:keepalive',
        'sdk:operation:metric',
    ];

    for (const type of types) {
        unsubs.push(
            bus.on(type, (evt) => {
                lastActivity = evt?.timestamp ?? Date.now();
                lastEventType = type;
                eventCount++;
            }),
        );
    }

    log('INFO', `[activity-tracker] ${unsubs.length} tipos de atividade rastreados`);

    return {
        name: 'ActivityTracker',
        hasAction: true,
        getSnapshot() {
            return {
                lastActivity,
                lastEventType,
                eventCount,
                idleMs: Date.now() - lastActivity,
            };
        },
        unsub() {
            for (const u of unsubs) u();
            unsubs.length = 0;
        },
    };
}
