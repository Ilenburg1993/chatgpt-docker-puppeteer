// @ts-check
/**
 * Feed local de transcript do terminal.
 *
 * O histórico do bridge cobre turnos explícitos. Mensagens da LLM-B que chegam por eventos SDK fora desse caminho
 * precisam de um buffer próprio para não dependerem apenas de stdout. A timeline reconciliada lê este feed junto ao
 * bridge e ao Hub persistido.
 *
 * @module copilot/terminal/state/transcript-state
 */

import { utf8ByteLength } from '#copilot/infra/public/buffer';

const MAX_TERMINAL_TRANSCRIPT_TURNS = 200;
const MAX_TERMINAL_TRANSCRIPT_BYTES = 512 * 1024;

/**
 * @typedef {{
 *     id: string;
 *     role: 'assistant' | 'user' | 'system' | 'llm_a';
 *     rawRole: string;
 *     content: string;
 *     byteLength: number;
 *     source: string;
 *     timestamp: number;
 * }} TerminalTranscriptTurn
 */

/** @type {TerminalTranscriptTurn[]} */
let _terminalTranscriptTurns = [];
let _terminalTranscriptBytes = 0;

/**
 * @param {string} content
 * @param {number} timestamp
 * @returns {string}
 */
function createTranscriptId(content, timestamp) {
    return `${timestamp.toString(36)}-${content.length.toString(36)}-${Math.abs(hashString(content)).toString(36)}`;
}

/**
 * @param {string} value
 * @returns {number}
 */
function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return hash;
}

/**
 * @param {{
 *     role?: 'assistant' | 'user' | 'system' | 'llm_a';
 *     rawRole?: string;
 *     content: string;
 *     source?: string;
 *     timestamp?: number;
 * }} turn
 * @returns {TerminalTranscriptTurn | null}
 */
export function appendTerminalTranscriptTurn(turn) {
    const content = turn.content.trim();
    if (!content) return null;
    const timestamp = turn.timestamp ?? Date.now();
    const role = turn.role ?? 'assistant';
    const byteLength = utf8ByteLength(content, 'terminal transcript content');
    const entry = {
        id: createTranscriptId(content, timestamp),
        role,
        rawRole: turn.rawRole ?? role,
        content,
        byteLength,
        source: turn.source ?? 'terminal.transcript',
        timestamp,
    };
    _terminalTranscriptTurns.push(entry);
    _terminalTranscriptBytes += byteLength;
    while (
        _terminalTranscriptTurns.length > MAX_TERMINAL_TRANSCRIPT_TURNS ||
        _terminalTranscriptBytes > MAX_TERMINAL_TRANSCRIPT_BYTES
    ) {
        const removed = _terminalTranscriptTurns.shift();
        if (!removed) break;
        _terminalTranscriptBytes = Math.max(0, _terminalTranscriptBytes - removed.byteLength);
    }
    return entry;
}

/**
 * @returns {TerminalTranscriptTurn[]}
 */
export function readTerminalTranscriptTurns() {
    return _terminalTranscriptTurns.map((turn) => ({ ...turn }));
}

/**
 * @returns {{ bytes: number; turns: number; maxBytes: number; maxTurns: number }}
 */
export function readTerminalTranscriptStats() {
    return {
        bytes: _terminalTranscriptBytes,
        turns: _terminalTranscriptTurns.length,
        maxBytes: MAX_TERMINAL_TRANSCRIPT_BYTES,
        maxTurns: MAX_TERMINAL_TRANSCRIPT_TURNS,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalTranscriptTurns() {
    _terminalTranscriptTurns = [];
    _terminalTranscriptBytes = 0;
}

export const __test__ = {
    clear: clearTerminalTranscriptTurns,
    stats: readTerminalTranscriptStats,
};
