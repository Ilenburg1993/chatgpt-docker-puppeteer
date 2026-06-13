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
import {
    appendTerminalTranscriptArchive,
    readTerminalTranscriptArchiveState,
    resetTerminalTranscriptArchiveForTests,
} from './transcript-archive.js';

const TERMINAL_TRANSCRIPT_SOFT_TURNS = 10_000;
const TERMINAL_TRANSCRIPT_SOFT_BYTES = 32 * 1024 * 1024;
const TERMINAL_TRANSCRIPT_CATASTROPHIC_TURNS = 100_000;
const TERMINAL_TRANSCRIPT_CATASTROPHIC_BYTES = 128 * 1024 * 1024;
const TERMINAL_TRANSCRIPT_HEAP_PRESSURE = 0.92;

/**
 * @typedef {{
 *     id: string;
 *     role: 'assistant' | 'user' | 'system' | 'llm_a';
 *     rawRole: string;
 *     content: string;
 *     byteLength: number;
 *     source: string;
 *     timestamp: number;
 *     archived: boolean;
 *     metadata: Record<string, unknown> | null;
 * }} TerminalTranscriptTurn
 */

/** @type {TerminalTranscriptTurn[]} */
let _terminalTranscriptTurns = [];
let _terminalTranscriptBytes = 0;
let _terminalTranscriptArchivedTurns = 0;
let _terminalTranscriptArchivedBytes = 0;
let _terminalTranscriptMemoryEvictions = 0;

/**
 * @returns {number}
 */
function readHeapPressure() {
    const usage = process.memoryUsage();
    if (usage.heapTotal <= 0) return 0;
    return usage.heapUsed / usage.heapTotal;
}

/**
 * @returns {boolean}
 */
function shouldReduceTranscriptMemory() {
    return (
        _terminalTranscriptTurns.length > TERMINAL_TRANSCRIPT_CATASTROPHIC_TURNS ||
        _terminalTranscriptBytes > TERMINAL_TRANSCRIPT_CATASTROPHIC_BYTES ||
        readHeapPressure() >= TERMINAL_TRANSCRIPT_HEAP_PRESSURE
    );
}

/**
 * @returns {void}
 */
function reduceTranscriptMemoryIfNeeded() {
    if (!shouldReduceTranscriptMemory()) return;
    const targetTurns = Math.min(TERMINAL_TRANSCRIPT_SOFT_TURNS, TERMINAL_TRANSCRIPT_CATASTROPHIC_TURNS);
    const targetBytes = Math.min(TERMINAL_TRANSCRIPT_SOFT_BYTES, TERMINAL_TRANSCRIPT_CATASTROPHIC_BYTES);
    while (
        _terminalTranscriptTurns.length > 0 &&
        (_terminalTranscriptTurns.length > targetTurns ||
            _terminalTranscriptBytes > targetBytes ||
            readHeapPressure() >= TERMINAL_TRANSCRIPT_HEAP_PRESSURE)
    ) {
        const removed = _terminalTranscriptTurns.shift();
        if (!removed) break;
        _terminalTranscriptBytes = Math.max(0, _terminalTranscriptBytes - removed.byteLength);
        _terminalTranscriptMemoryEvictions += 1;
    }
}

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
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function normalizeTranscriptMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return { .../** @type {Record<string, unknown>} */ (value) };
}

/**
 * @param {{
 *     role?: 'assistant' | 'user' | 'system' | 'llm_a';
 *     rawRole?: string;
 *     content: string;
 *     source?: string;
 *     timestamp?: number;
 *     metadata?: Record<string, unknown> | null;
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
        archived: false,
        metadata: normalizeTranscriptMetadata(turn.metadata),
    };
    const archive = appendTerminalTranscriptArchive(entry);
    entry.archived = archive.archived;
    if (archive.archived) {
        _terminalTranscriptArchivedTurns += 1;
        _terminalTranscriptArchivedBytes += entry.byteLength;
    }
    _terminalTranscriptTurns.push(entry);
    _terminalTranscriptBytes += byteLength;
    reduceTranscriptMemoryIfNeeded();
    return entry;
}

/**
 * @returns {TerminalTranscriptTurn[]}
 */
export function readTerminalTranscriptTurns() {
    return _terminalTranscriptTurns.map((turn) => ({ ...turn }));
}

/**
 * @returns {{
 *     bytes: number;
 *     turns: number;
 *     softBytes: number;
 *     softTurns: number;
 *     maxBytes: number;
 *     maxTurns: number;
 *     catastrophicBytes: number;
 *     catastrophicTurns: number;
 *     heapPressure: number;
 *     archivedTurns: number;
 *     archivedBytes: number;
 *     memoryEvictions: number;
 *     archivePath: string | null;
 *     archiveError: string | null;
 *     archiveQueueDepth: number;
 *     archiveDroppedTurns: number;
 * }}
 */
export function readTerminalTranscriptStats() {
    const archive = readTerminalTranscriptArchiveState();
    return {
        bytes: _terminalTranscriptBytes,
        turns: _terminalTranscriptTurns.length,
        softBytes: TERMINAL_TRANSCRIPT_SOFT_BYTES,
        softTurns: TERMINAL_TRANSCRIPT_SOFT_TURNS,
        maxBytes: TERMINAL_TRANSCRIPT_CATASTROPHIC_BYTES,
        maxTurns: TERMINAL_TRANSCRIPT_CATASTROPHIC_TURNS,
        catastrophicBytes: TERMINAL_TRANSCRIPT_CATASTROPHIC_BYTES,
        catastrophicTurns: TERMINAL_TRANSCRIPT_CATASTROPHIC_TURNS,
        heapPressure: readHeapPressure(),
        archivedTurns: _terminalTranscriptArchivedTurns,
        archivedBytes: _terminalTranscriptArchivedBytes,
        memoryEvictions: _terminalTranscriptMemoryEvictions,
        archivePath: archive.path,
        archiveError: archive.error,
        archiveQueueDepth: archive.queueDepth,
        archiveDroppedTurns: archive.droppedLines,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalTranscriptTurns() {
    _terminalTranscriptTurns = [];
    _terminalTranscriptBytes = 0;
    _terminalTranscriptArchivedTurns = 0;
    _terminalTranscriptArchivedBytes = 0;
    _terminalTranscriptMemoryEvictions = 0;
    resetTerminalTranscriptArchiveForTests();
}

export const __test__ = {
    clear: clearTerminalTranscriptTurns,
    stats: readTerminalTranscriptStats,
};
