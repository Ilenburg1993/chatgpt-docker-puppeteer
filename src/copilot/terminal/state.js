// @ts-check
/**
 * src/copilot/terminal/state.js
 *
 * Estado global compartilhado do Terminal Permanente LLM-B.
 *
 * Centraliza as variáveis mutáveis que precisam ser acessadas por dialog.js, server.js e repl.js sem depender de
 * closures no terminal-server.js monolítico.
 *
 * **F1 (Fase 2)**: expõe `stateEmitter` (EventEmitter) para observabilidade reativa. Emite eventos ao mudar campos
 * críticos, permitindo que consumidores reajam sem polling.
 *
 * Eventos emitidos:
 *
 * - `'hubSessionId:changed'` `(newId: string | null, prevId: string | null)` — ao mudar a hub session
 * - `'busy:changed'` `(busy: boolean)` — ao mudar o estado de ocupação do terminal
 *
 * @module copilot/terminal/state
 */

import {
    TERMINAL_MAX_ATTACHMENTS,
    TERMINAL_MAX_INJECT_HISTORY,
    TERMINAL_MAX_LISTENERS,
    TERMINAL_SHOW_STREAMING,
    TERMINAL_SHOW_THINKING,
    TERMINAL_SHOW_USAGE,
} from '#copilot/config/env';
import { CopilotError } from '#copilot/core/errors';
import EventEmitter from 'node:events';
import { SseReplayBuffer } from '../api/sse/replay-buffer.js';

// ─── Emitter reativo ──────────────────────────────────────────────────────────

/**
 * EventEmitter singleton para observar mudanças de estado do terminal.
 *
 * @example
 *     import { stateEmitter } from './state.js';
 *     stateEmitter.on('busy:changed', (busy) => console.log('terminal busy:', busy));
 */
export const stateEmitter = new EventEmitter();
// T-23: setMaxListeners calculado em vez de hardcoded (base 10 + margem p/ hot patches)
stateEmitter.setMaxListeners(TERMINAL_MAX_LISTENERS);

/**
 * F55/F314 — Constantes de eventos do stateEmitter do terminal.
 */
export const TERMINAL_EVENTS = /** @type {const} */ ({
    HUB_SESSION_CHANGED: 'hubSessionId:changed',
    BUSY_CHANGED: 'busy:changed',
    SHOW_THINKING_CHANGED: 'showThinking:changed',
    SHOW_USAGE_CHANGED: 'showUsage:changed',
    SHOW_STREAMING_CHANGED: 'showStreaming:changed',
});

// ─── Estado compartilhado ─────────────────────────────────────────────────────

/** ID da hub_session permanente criada no boot. @type {string | null} */
let _hubSessionId = null;

/** Mutex simples: evita dois turnos simultâneos. @type {boolean} */
let _busy = false;

/** Interface readline ativa. @type {import('node:readline').Interface | null} */
let _rl = null;

/** Fila de arquivos a embutir no próximo turno (via `/attach` ou `@path`). @type {string[]} */
let _attachmentQueue = [];
// T-22: limite máximo da fila de attachments (configurável via ENV)
const MAX_ATTACHMENT_QUEUE = TERMINAL_MAX_ATTACHMENTS;

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

/**
 * FASE-12.2: Buffer circular de replay SSE do terminal.
 *
 * Permite que clientes reconectando (com Last-Event-ID) recebam os eventos perdidos.
 */
const _terminalReplayBuffer = new SseReplayBuffer();

// ─── Getters / setters ────────────────────────────────────────────────────────

/** @returns {string | null} */
export function getHubSessionId() {
    return _hubSessionId;
}
/** @param {string | null} id @returns {void} */
export function setHubSessionId(id) {
    const prev = _hubSessionId;
    _hubSessionId = id;
    if (prev !== id) stateEmitter.emit(TERMINAL_EVENTS.HUB_SESSION_CHANGED, id, prev);
}

/** @returns {boolean} */
export function getBusy() {
    return _busy;
}
/** @param {boolean} value @returns {void} */
export function setBusy(value) {
    const prev = _busy;
    _busy = value;
    if (prev !== value) stateEmitter.emit(TERMINAL_EVENTS.BUSY_CHANGED, value);
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

/** FASE-12.2: @returns {SseReplayBuffer} */
export function getTerminalReplayBuffer() {
    return _terminalReplayBuffer;
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
    // T-22: verificar limite antes de enfileirar
    if (_attachmentQueue.length >= MAX_ATTACHMENT_QUEUE) {
        throw new CopilotError(`[terminal/state] Fila de attachments cheia (máx: ${MAX_ATTACHMENT_QUEUE})`);
    }
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

// ─── Thinking display (F18.2) ─────────────────────────────────────────────────

/**
 * F18.2: Flag para exibir reasoning/thinking da LLM-B em tempo real no stdout. Controlável via comando `/thinking` e
 * variável de ambiente `TERMINAL_SHOW_THINKING`.
 *
 * @type {boolean}
 */
let _showThinking = TERMINAL_SHOW_THINKING;

/** @returns {boolean} */
export function getShowThinking() {
    return _showThinking;
}

/** @param {boolean} value @returns {void} */
export function setShowThinking(value) {
    _showThinking = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_THINKING_CHANGED, value);
}

// ─── Usage display (F20.2) ────────────────────────────────────────────────────

/**
 * F20.2: Flag para exibir usage summary (tokens, custo) após cada turno. Controlável via comando `/usage` e variável de
 * ambiente `TERMINAL_SHOW_USAGE`.
 *
 * @type {boolean}
 */
let _showUsage = TERMINAL_SHOW_USAGE;

/** @returns {boolean} */
export function getShowUsage() {
    return _showUsage;
}

/** @param {boolean} value @returns {void} */
export function setShowUsage(value) {
    _showUsage = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_USAGE_CHANGED, value);
}

// ─── Streaming display (F19.2) ───────────────────────────────────────────────

/**
 * F19.2: Flag para exibir resposta em streaming (message deltas) inline. Controlável via comando `/display streaming` e
 * variável de ambiente `TERMINAL_SHOW_STREAMING`.
 *
 * @type {boolean}
 */
let _showStreaming = TERMINAL_SHOW_STREAMING;

/** @returns {boolean} */
export function getShowStreaming() {
    return _showStreaming;
}

/** @param {boolean} value @returns {void} */
export function setShowStreaming(value) {
    _showStreaming = value;
    stateEmitter.emit(TERMINAL_EVENTS.SHOW_STREAMING_CHANGED, value);
}

// ─── Inject history (F16.3) ──────────────────────────────────────────────────

const MAX_INJECT_HISTORY = TERMINAL_MAX_INJECT_HISTORY;

/**
 * @typedef {{
 *     ts: number;
 *     from: string;
 *     message: string;
 *     replySnippet: string | null;
 *     durationMs: number;
 *     ok: boolean;
 * }} InjectHistoryEntry
 */

/** @type {InjectHistoryEntry[]} */
let _injectHistory = [];

/**
 * Registra uma injeção no histórico circular (máx `TERMINAL_MAX_INJECT_HISTORY`).
 *
 * @param {InjectHistoryEntry} entry
 * @returns {void}
 */
export function recordInjectHistory(entry) {
    _injectHistory.push(entry);
    if (_injectHistory.length > MAX_INJECT_HISTORY) {
        _injectHistory = _injectHistory.slice(-MAX_INJECT_HISTORY);
    }
}

/**
 * Retorna as últimas `n` entradas do histórico.
 *
 * @param {number} [n=50] Default is `50`
 * @returns {InjectHistoryEntry[]}
 */
export function getInjectHistory(n = 50) {
    const limit = Math.min(Math.max(1, n), MAX_INJECT_HISTORY);
    return _injectHistory.slice(-limit);
}
