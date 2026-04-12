// @ts-check
/**
 * src/copilot/events/system-events.js
 *
 * Constantes de eventos de sistema: shutdown, config, health, bridges (MCP, NERV).
 *
 * FAIXA-2A: parte do SSOT de eventos. Consumidores devem importar de `#copilot/events`.
 *
 * @module copilot/events/system-events
 * @see EventBus
 */

// ─── Shutdown ─────────────────────────────────────────────────────────────────

/** @readonly */
export const SYSTEM_SHUTDOWN_STARTED = 'system:shutdown:started';
/** @readonly */
export const SYSTEM_SHUTDOWN_COMPLETE = 'system:shutdown:complete';

// ─── Config ───────────────────────────────────────────────────────────────────

/** @readonly */
export const CONFIG_PINNED_FILES_CHANGED = 'config:pinned_files:changed';
/** @readonly */
export const CONFIG_CHANGED = 'config:changed';

// ─── Health ───────────────────────────────────────────────────────────────────

/** @readonly */
export const HEALTH_CHECK = 'health:check';
/** @readonly */
export const HEALTH_DEGRADED = 'health:degraded';
/** @readonly */
export const HEALTH_RECOVERED = 'health:recovered';

// ─── Bridge status ────────────────────────────────────────────────────────────

/** @readonly */
export const BRIDGE_MCP_RECONNECTED = 'bridge:mcp:reconnected';
/** @readonly */
export const BRIDGE_NERV_CONNECTED = 'bridge:nerv:connected';
/** @readonly */
export const BRIDGE_NERV_DISCONNECTED = 'bridge:nerv:disconnected';
