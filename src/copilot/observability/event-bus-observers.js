// @ts-check
/**
 * src/copilot/observability/event-bus-observers.js
 *
 * FAIXA-2D — Subscribers cross-module do EventBus para observabilidade.
 *
 * Complementa o `agent-event-observer.js` (que escuta diretamente o AgentEmitter) com subscribers via EventBus global,
 * permitindo observar eventos bridgeados de outros módulos (HookBus, DialogLoop, HandoffManager, PinnedFilesLoader,
 * HubOrchestrator).
 *
 * Deve ser chamado após `bootstrapObservability()` e após o EventBus estar registrado no container.
 *
 * Design:
 *
 * - Zero acoplamento de runtime com módulos de nível superior
 * - Todos os subscribers são registrados via `bus.on()` e podem ser removidos via `detach()`
 * - Seguro a erros: exceções nos handlers são capturadas e logadas
 *
 * @module copilot/observability/event-bus-observers
 * @see EventBus
 */

import { container } from '../core/di-container.js';
import { EVENT_BUS } from '../core/di-tokens.js';
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
} from '../events/index.js';
import { log } from './logger.js';

/**
 * @typedef {() => void} Unsubscribe
 */

/**
 * Cria um wrapper de handler seguro que captura exceções.
 *
 * @param {() => void} fn
 * @param {string} context
 * @returns {() => void}
 */
function safe(fn, context) {
    return () => {
        try {
            fn();
        } catch (/** @type {any} */ err) {
            log('WARN', `[event-bus-observers] erro no handler ${context}: ${err?.message ?? err}`);
        }
    };
}

/** @type {Unsubscribe[]} */
let _registrations = [];

/** @type {boolean} */
let _attached = false;

/**
 * Registra subscribers do EventBus global para observabilidade cross-module.
 *
 * Idempotente — segunda chamada é no-op.
 *
 * @returns {void}
 */
export function attachEventBusObservers() {
    if (_attached) return;

    const bus = container.resolve(EVENT_BUS);
    if (!bus) {
        log('WARN', '[event-bus-observers] EventBus não disponível — observers não registrados');
        return;
    }

    /**
     * @param {string} event
     * @param {(...args: any[]) => void} listener
     */
    function on(event, listener) {
        const unsub = bus.on(event, listener);
        _registrations.push(unsub);
    }

    // ── Agent lifecycle ───────────────────────────────────────────────────────
    on(
        AGENT_READY,
        safe(() => {
            log('INFO', '[event-bus-observers] agent:ready recebido via EventBus');
        }, 'agent:ready'),
    );

    // ── Dialog loop (via DialogLoopManager bridge) ────────────────────────────
    on(
        AGENT_DIALOG_LOOP_CHANGED,
        safe(() => {
            log('DEBUG', '[event-bus-observers] dialog:loop:changed via EventBus');
        }, 'dialog:loop:changed'),
    );

    on(
        AGENT_DIALOG_STALLED,
        safe(() => {
            log('WARN', '[event-bus-observers] dialog:stalled via EventBus');
        }, 'dialog:stalled'),
    );

    on(
        AGENT_DIALOG_TURN_TIMEOUT,
        safe(() => {
            log('WARN', '[event-bus-observers] dialog:turn_timeout via EventBus');
        }, 'dialog:turn_timeout'),
    );

    // ── Hook events (via HookBus bridge) ─────────────────────────────────────
    on(
        HOOK_PRE_TOOL_USE,
        safe(() => {
            log('DEBUG', '[event-bus-observers] hook:pre_tool_use via EventBus');
        }, 'hook:pre_tool_use'),
    );

    on(
        HOOK_POST_TOOL_USE,
        safe(() => {
            log('DEBUG', '[event-bus-observers] hook:post_tool_use via EventBus');
        }, 'hook:post_tool_use'),
    );

    on(
        HOOK_SESSION_START,
        safe(() => {
            log('INFO', '[event-bus-observers] hook:session_start via EventBus');
        }, 'hook:session_start'),
    );

    on(
        HOOK_SESSION_END,
        safe(() => {
            log('INFO', '[event-bus-observers] hook:session_end via EventBus');
        }, 'hook:session_end'),
    );

    on(
        HOOK_ERROR_OCCURRED,
        safe(() => {
            log('ERROR', '[event-bus-observers] hook:error_occurred via EventBus');
        }, 'hook:error_occurred'),
    );

    // ── Handoff (via HandoffManager bridge) ──────────────────────────────────
    on(
        AGENT_HANDOFF_RECEIVED,
        safe(() => {
            log('INFO', '[event-bus-observers] agent:handoff:received via EventBus');
        }, 'handoff:received'),
    );

    on(
        AGENT_HANDOFF_ACCEPTED,
        safe(() => {
            log('INFO', '[event-bus-observers] agent:handoff:accepted via EventBus');
        }, 'handoff:accepted'),
    );

    on(
        AGENT_HANDOFF_REJECTED,
        safe(() => {
            log('WARN', '[event-bus-observers] agent:handoff:rejected via EventBus');
        }, 'handoff:rejected'),
    );

    // ── Hub session (via HubOrchestrator bridge) ──────────────────────────────
    on(
        HUB_SESSION_CREATED,
        safe(() => {
            log('INFO', '[event-bus-observers] hub:session:created via EventBus');
        }, 'hub:session:created'),
    );

    on(
        HUB_SESSION_CLOSED,
        safe(() => {
            log('INFO', '[event-bus-observers] hub:session:closed via EventBus');
        }, 'hub:session:closed'),
    );

    // ── Config (via PinnedFilesLoader bridge) ─────────────────────────────────
    on(
        CONFIG_PINNED_FILES_CHANGED,
        safe(() => {
            log('INFO', '[event-bus-observers] config:pinned_files:changed via EventBus');
        }, 'config:pinned_files:changed'),
    );

    _attached = true;
    log('INFO', `[event-bus-observers] ${_registrations.length} subscribers registrados no EventBus`);
}

/**
 * Remove todos os subscribers registrados do EventBus.
 *
 * @returns {void}
 */
export function detachEventBusObservers() {
    for (const unsub of _registrations) {
        unsub();
    }
    _registrations = [];
    _attached = false;
    log('INFO', '[event-bus-observers] Subscribers removidos do EventBus');
}
