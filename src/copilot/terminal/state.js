// @ts-check
/**
 * src/copilot/terminal/state.js
 *
 * Estado global compartilhado do Terminal Permanente LLM-B.
 *
 * Centraliza as variáveis mutáveis que precisam ser acessadas por dialog.js, server.js e repl.js sem depender de
 * closures no terminal-server.js monolítico.
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

/** Fila de arquivos a embutir no próximo turno (via `/attach` ou `@path`). @type {string[]} */
let _attachmentQueue = [];

/** Modo planejamento: prefaça mensagens com instrução de plano antes de enviar. @type {boolean} */
let _planMode = false;

/**
 * Clientes SSE conectados ao endpoint GET /events (todos os eventos).
 *
 * @type {Set<import('node:http').ServerResponse>}
 */
const _sseClients = new Set();

/**
 * Clientes SSE que pedem apenas eventos críticos (?level=critical) — stalled, fatal, system.
 *
 * @type {Set<import('node:http').ServerResponse>}
 */
const _sseCriticalClients = new Set();

// ─── Getters / setters ────────────────────────────────────────────────────────

/** @returns {string | null} */
export function getHubSessionId() {
    return _hubSessionId;
}
/** @param {string | null} id @returns {void} */
export function setHubSessionId(id) {
    _hubSessionId = id;
}

/** @returns {boolean} */
export function getBusy() {
    return _busy;
}
/** @param {boolean} value @returns {void} */
export function setBusy(value) {
    _busy = value;
}

/** @returns {import('node:readline').Interface | null} */
export function getRl() {
    return _rl;
}
/** @param {import('node:readline').Interface | null} value @returns {void} */
export function setRl(value) {
    _rl = value;
}

/** @returns {Set<import('node:http').ServerResponse>} */
export function getSseClients() {
    return _sseClients;
}

/** @returns {Set<import('node:http').ServerResponse>} */
export function getSseCriticalClients() {
    return _sseCriticalClients;
}

// ─── Attachment queue ─────────────────────────────────────────────────────────

/** @returns {string[]} Cópia defensiva da fila de arquivos. */
export function getAttachmentQueue() {
    return [..._attachmentQueue];
}

/**
 * Adiciona um caminho de arquivo à fila de attachments.
 *
 * @param {string} filePath
 * @returns {void}
 */
export function addAttachment(filePath) {
    if (!_attachmentQueue.includes(filePath)) {
        _attachmentQueue.push(filePath);
    }
}

/** Limpa a fila de attachments. @returns {void} */
export function clearAttachments() {
    _attachmentQueue = [];
}

// ─── Plan mode ────────────────────────────────────────────────────────────────

/** @returns {boolean} */
export function getPlanMode() {
    return _planMode;
}

/** @param {boolean} value @returns {void} */
export function setPlanMode(value) {
    _planMode = value;
}
