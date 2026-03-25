// @ts-check
/**
 * src/copilot/terminal/state.js
 *
 * Estado global compartilhado do Terminal Permanente LLM-B.
 *
 * Centraliza as variáveis mutáveis que precisam ser acessadas por dialog.js,
 * server.js e repl.js sem depender de closures no terminal-server.js monolítico.
 *
 * @module copilot/terminal/state
 */

// ─── Estado compartilhado ─────────────────────────────────────────────────────

/** ID da hub_session permanente criada no boot. @type {string | null} */
let _hubSessionId = null;

/** Mutex simples: evita dois turnos simultâneos. @type {boolean} */
let _busy = false;

/** Interface readline ativa. @type {import('node:readline').Interface | null} */
let _rl = null;

/**
 * Clientes SSE conectados ao endpoint GET /events (todos os eventos).
 * @type {Set<import('node:http').ServerResponse>}
 */
const _sseClients = new Set();

/**
 * Clientes SSE que pedem apenas eventos críticos (?level=critical) — stalled, fatal, system.
 * @type {Set<import('node:http').ServerResponse>}
 */
const _sseCriticalClients = new Set();

// ─── Getters / setters ────────────────────────────────────────────────────────

/** @returns {string | null} */
export function getHubSessionId() { return _hubSessionId; }
/** @param {string | null} id @returns {void} */
export function setHubSessionId(id) { _hubSessionId = id; }

/** @returns {boolean} */
export function getBusy() { return _busy; }
/** @param {boolean} value @returns {void} */
export function setBusy(value) { _busy = value; }

/** @returns {import('node:readline').Interface | null} */
export function getRl() { return _rl; }
/** @param {import('node:readline').Interface | null} value @returns {void} */
export function setRl(value) { _rl = value; }

/** @returns {Set<import('node:http').ServerResponse>} */
export function getSseClients() { return _sseClients; }

/** @returns {Set<import('node:http').ServerResponse>} */
export function getSseCriticalClients() { return _sseCriticalClients; }
