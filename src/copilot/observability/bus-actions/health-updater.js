// @ts-check
/**
 * src/copilot/observability/bus-actions/health-updater.js — FAIXA-L15
 *
 * EventBus subscriber que mantém health score do sistema baseado em eventos.
 * O score é um valor 0-100 que degrada com erros/timeouts e recupera com
 * eventos de sucesso.
 *
 * @module copilot/observability/bus-actions/health-updater
 */

import { log } from '../logger.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 */

/**
 * @typedef {object} HealthState
 * @property {number} score - 0 a 100
 * @property {string} status - 'healthy' | 'degraded' | 'critical'
 * @property {number} lastUpdate - timestamp ms
 */

/** @param {number} val @param {number} min @param {number} max @returns {number} */
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/**
 * @param {{ bus: EventBus }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string; getHealth: () => HealthState }}
 */
export function createHealthUpdater({ bus }) {
    /** @type {HealthState} */
    const state = { score: 100, status: 'healthy', lastUpdate: Date.now() };
    /** @type {Array<() => void>} */
    const unsubs = [];

    function update() {
        state.lastUpdate = Date.now();
        if (state.score >= 80) state.status = 'healthy';
        else if (state.score >= 40) state.status = 'degraded';
        else state.status = 'critical';
    }

    /** @param {number} delta */
    function degrade(delta) {
        state.score = clamp(state.score - delta, 0, 100);
        update();
    }

    /** @param {number} delta */
    function recover(delta) {
        state.score = clamp(state.score + delta, 0, 100);
        update();
    }

    // Degradation events
    unsubs.push(bus.on('agent:session:fatal', () => { degrade(30); }));
    unsubs.push(bus.on('agent:task:error', () => { degrade(10); }));
    unsubs.push(bus.on('agent:dialog:turn_timeout', () => { degrade(15); }));
    unsubs.push(bus.on('agent:dialog:stalled', () => { degrade(5); }));
    unsubs.push(bus.on('hook:error_occurred', () => { degrade(10); }));

    // Recovery events
    unsubs.push(bus.on('agent:dialog:turn_end', () => { recover(2); }));
    unsubs.push(bus.on('agent:task:completed', () => { recover(5); }));
    unsubs.push(bus.on('agent:ready', () => { recover(10); }));
    unsubs.push(bus.on('agent:session:compaction_complete', () => { recover(3); }));

    log('INFO', `[health-updater] ${unsubs.length} eventos de health monitorados`);

    return {
        name: 'HealthUpdater',
        hasAction: true,
        getHealth() { return { ...state }; },
        unsub() {
            for (const u of unsubs) u();
            unsubs.length = 0;
        },
    };
}
