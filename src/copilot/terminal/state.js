// @ts-check
/**
 * src/copilot/terminal/state.js
 * @module copilot/terminal/state
 * @see EventBus
 */

import {
    TERMINAL_MAX_ATTACHMENTS,
    TERMINAL_MAX_INJECT_HISTORY,
    TERMINAL_MAX_LISTENERS,
    TERMINAL_SHOW_STREAMING,
    TERMINAL_SHOW_THINKING,
    TERMINAL_SHOW_USAGE,
} from '#copilot/config';
import { CopilotError, getHubSessionId as _getCoreHubSessionId, setSharedHubSessionId } from '#copilot/core';
import { createEmitter } from '#copilot/core';
import { SseReplayBuffer } from '../api/sse/replay-buffer.js';

// ─── Emitter reativo ─────────────────────────────────────────────────────────

/**
 * EventEmitter singleton para observar mudanças de estado do terminal.
 *
 * @example
 *     import { stateEmitter } from './state.js';
 *     stateEmitter.on('busy:changed', (busy) => console.log('terminal busy:', busy));
 */
export const stateEmitter = createEmitter();
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

// ─── Estado compartilhado ────────────────────────────────────────────────────

// _hubSessionId é gerenciado em core/shared-state.js para permitir leitura por
// módulos de camadas inferiores (ex: agent/) sem criar dependência de terminal/.

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

// ─── Getters / setters ───────────────────────────────────────────────────────

/** @returns {string | null} */
export function getHubSessionId() {
    return _getCoreHubSessionId();
}
/** @param {string | null} id @returns {void} */
export function setHubSessionId(id) {
    const prev = _getCoreHubSessionId();
    setSharedHubSessionId(id);
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
    if (prev !== value) {
        stateEmitter.emit(TERMINAL_EVENTS.BUSY_CHANGED, value);
        // K-6c: sincronizar FSM com flag busy (best-effort — não lança)
        try {
            if (value && _phase === TerminalPhase.IDLE) {
                transitionTerminalPhase(TerminalPhase.BUSY);
            } else if (!value && _phase === TerminalPhase.BUSY) {
                transitionTerminalPhase(TerminalPhase.IDLE);
            }
        } catch {
            // Transição inválida — ignora (FSM pode estar em shutting_down)
        }
    }
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

// ─── Attachment queue ────────────────────────────────────────────────────────

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

// ─── Plan mode ───────────────────────────────────────────────────────────────

/** @returns {boolean} */
export function getPlanMode() {
    return _planMode;
}

/** @param {boolean} value @returns {void} */
export function setPlanMode(value) {
    _planMode = value;
}

// ─── Thinking display (F18.2) ────────────────────────────────────────────────

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

// ─── Usage display (F20.2) ───────────────────────────────────────────────────

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

// ─── K-6: Terminal State Machine ─────────────────────────────────────────────

/**
 * Fases do terminal (state machine formal).
 *
 * @readonly
 * @enum {string}
 */
export const TerminalPhase = /** @type {const} */ ({
    INIT: 'init',
    IDLE: 'idle',
    BUSY: 'busy',
    SHUTTING_DOWN: 'shutting_down',
    STOPPED: 'stopped',
});

/**
 * Transições válidas do terminal state machine.
 *
 * @type {ReadonlyMap<string, readonly string[]>}
 */
const VALID_TRANSITIONS = new Map([
    [TerminalPhase.INIT, [TerminalPhase.IDLE, TerminalPhase.STOPPED]],
    [TerminalPhase.IDLE, [TerminalPhase.BUSY, TerminalPhase.SHUTTING_DOWN]],
    [TerminalPhase.BUSY, [TerminalPhase.IDLE, TerminalPhase.SHUTTING_DOWN]],
    [TerminalPhase.SHUTTING_DOWN, [TerminalPhase.STOPPED]],
    [TerminalPhase.STOPPED, []],
]);

/** @type {string} */
let _phase = TerminalPhase.INIT;

/**
 * Retorna a fase atual do terminal.
 *
 * @returns {string}
 */
export function getTerminalPhase() {
    return _phase;
}

/**
 * Transiciona o terminal para uma nova fase. Valida a transição e emite evento.
 *
 * @param {string} next - Próxima fase (deve ser um valor de `TerminalPhase`).
 * @returns {void}
 * @throws {CopilotError} Se a transição for inválida.
 */
export function transitionTerminalPhase(next) {
    const allowed = VALID_TRANSITIONS.get(_phase);
    if (!allowed?.includes(next)) {
        throw new CopilotError(
            `[TerminalSM] transição inválida: ${_phase} → ${next} (permitidas: ${allowed?.join(', ') ?? 'nenhuma'})`,
            'STATE_TRANSITION_ERROR',
        );
    }
    const prev = _phase;
    _phase = next;
    stateEmitter.emit('phase:changed', next, prev);
}
