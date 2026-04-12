// @ts-check
/**
 * src/copilot/observability/bus-actions/log-observer.js — FAIXA-L23
 *
 * EventBus subscriber que loga eventos cross-module para observabilidade. Substitui o antigo `event-bus-observers.js`
 * (que era standalone/idempotente) pelo padrão unificado de bus-action (L15).
 *
 * @module copilot/observability/bus-actions/log-observer
 */

import {
    AGENT_DIALOG_LOOP_CHANGED,
    AGENT_DIALOG_STALLED,
    AGENT_DIALOG_TURN_TIMEOUT,
    AGENT_HANDOFF_ACCEPTED,
    AGENT_HANDOFF_RECEIVED,
    AGENT_HANDOFF_REJECTED,
    AGENT_READY,
    CONFIG_PINNED_FILES_CHANGED,
    HOOK_ERROR_OCCURRED,
    HOOK_POST_TOOL_USE,
    HOOK_PRE_TOOL_USE,
    HOOK_SESSION_END,
    HOOK_SESSION_START,
    HUB_SESSION_CLOSED,
    HUB_SESSION_CREATED,
} from '../../events/index.js';
import { log } from '../logger.js';

/**
 * @typedef {import('../../core/event-bus.js').EventBus} EventBus
 */

/**
 * Cria um bus-action que loga eventos cross-module via EventBus.
 *
 * @param {{ bus: EventBus }} deps
 * @returns {{ unsub: () => void; hasAction: true; name: string }}
 */
export function createLogObserver({ bus }) {
    /** @type {(() => void)[]} */
    const unsubs = [];

    /**
     * @param {string} type
     * @param {import('../logger.js').LogLevel} level
     * @param {string} label
     */
    function on(type, level, label) {
        unsubs.push(
            bus.on(type, () => {
                try {
                    log(level, `[log-observer] ${label} via EventBus`);
                } catch (/** @type {any} */ e) {
                    log('WARN', `[log-observer] erro em ${type}: ${e?.message}`);
                }
            }),
        );
    }

    // Agent lifecycle
    on(AGENT_READY, 'INFO', 'agent:ready');

    // Dialog loop
    on(AGENT_DIALOG_LOOP_CHANGED, 'DEBUG', 'dialog:loop:changed');
    on(AGENT_DIALOG_STALLED, 'WARN', 'dialog:stalled');
    on(AGENT_DIALOG_TURN_TIMEOUT, 'WARN', 'dialog:turn_timeout');

    // Hook events
    on(HOOK_PRE_TOOL_USE, 'DEBUG', 'hook:pre_tool_use');
    on(HOOK_POST_TOOL_USE, 'DEBUG', 'hook:post_tool_use');
    on(HOOK_SESSION_START, 'INFO', 'hook:session_start');
    on(HOOK_SESSION_END, 'INFO', 'hook:session_end');
    on(HOOK_ERROR_OCCURRED, 'ERROR', 'hook:error_occurred');

    // Handoff
    on(AGENT_HANDOFF_RECEIVED, 'INFO', 'handoff:received');
    on(AGENT_HANDOFF_ACCEPTED, 'INFO', 'handoff:accepted');
    on(AGENT_HANDOFF_REJECTED, 'WARN', 'handoff:rejected');

    // Hub session
    on(HUB_SESSION_CREATED, 'INFO', 'hub:session:created');
    on(HUB_SESSION_CLOSED, 'INFO', 'hub:session:closed');

    // Config
    on(CONFIG_PINNED_FILES_CHANGED, 'INFO', 'config:pinned_files:changed');

    log('INFO', `[log-observer] ${unsubs.length} subscribers registrados no EventBus`);

    return {
        unsub: () => {
            for (const u of unsubs) u();
            unsubs.length = 0;
        },
        hasAction: true,
        name: 'log-observer',
    };
}
