// @ts-check
/**
 * src/copilot/events/terminal-events.js
 *
 * Constantes de eventos do Terminal Server e pipeline de auditoria.
 *
 * FAIXA-2A: parte do SSOT de eventos. Consumidores devem importar de `#copilot/events`.
 *
 * @module copilot/events/terminal-events
 * @see EventBus
 */

// ─── Terminal ─────────────────────────────────────────────────────────────────

/** @readonly */
export const TERMINAL_STARTED = 'terminal:started';
/** @readonly */
export const TERMINAL_STOPPED = 'terminal:stopped';
/** @readonly */
export const TERMINAL_COMMAND = 'terminal:command';

// ─── Audit ────────────────────────────────────────────────────────────────────

/** @readonly */
export const AUDIT_ENTRY = 'audit:entry';
/** @readonly */
export const AUDIT_FLUSH = 'audit:flush';
/** @readonly */
export const AUDIT_LOG = 'audit:log';
/** @readonly */
export const AUDIT_QUICK = 'audit:quick';
