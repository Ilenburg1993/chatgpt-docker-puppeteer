// @ts-check
/**
 * Estado local de intents explícitos da LLM-B.
 *
 * `assistant.intent`, a built-in `report_intent` e a tool local `report_intent_local` são mensagens operacionais
 * humanas, não apenas telemetria. Este store preserva essas intenções para consulta posterior e deixa o renderer livre
 * para deduplicar múltiplos eventos SDK que representem o mesmo gesto.
 *
 * @module copilot/terminal/state/intent-state
 */

import { utf8ByteLength } from '#copilot/infra/public/platform/buffer';

const TERMINAL_INTENT_SOFT_ENTRIES = 10_000;
const TERMINAL_INTENT_SOFT_BYTES = 16 * 1024 * 1024;
const TERMINAL_INTENT_CATASTROPHIC_ENTRIES = 100_000;
const TERMINAL_INTENT_CATASTROPHIC_BYTES = 64 * 1024 * 1024;
const TERMINAL_INTENT_HEAP_PRESSURE = 0.92;

/**
 * @typedef {'low' | 'medium' | 'high' | 'unknown'} TerminalIntentRisk
 */

/**
 * @typedef {{
 *     id: string;
 *     timestamp: number;
 *     intent: string;
 *     tool: string | null;
 *     risk: TerminalIntentRisk;
 *     source: string;
 *     toolCallId: string | null;
 *     byteLength: number;
 * }} TerminalIntentEntry
 */

/** @type {TerminalIntentEntry[]} */
let _terminalIntentHistory = [];
let _terminalIntentBytes = 0;
let _terminalIntentMemoryEvictions = 0;

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
function shouldReduceIntentMemory() {
    return (
        _terminalIntentHistory.length > TERMINAL_INTENT_CATASTROPHIC_ENTRIES ||
        _terminalIntentBytes > TERMINAL_INTENT_CATASTROPHIC_BYTES ||
        readHeapPressure() >= TERMINAL_INTENT_HEAP_PRESSURE
    );
}

/**
 * @returns {void}
 */
function reduceIntentMemoryIfNeeded() {
    if (!shouldReduceIntentMemory()) return;
    while (
        _terminalIntentHistory.length > 0 &&
        (_terminalIntentHistory.length > TERMINAL_INTENT_SOFT_ENTRIES ||
            _terminalIntentBytes > TERMINAL_INTENT_SOFT_BYTES ||
            readHeapPressure() >= TERMINAL_INTENT_HEAP_PRESSURE)
    ) {
        const removed = _terminalIntentHistory.shift();
        if (!removed) break;
        _terminalIntentBytes = Math.max(0, _terminalIntentBytes - removed.byteLength);
        _terminalIntentMemoryEvictions += 1;
    }
}

/**
 * @param {unknown} value
 * @returns {TerminalIntentRisk}
 */
export function normalizeTerminalIntentRisk(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text === 'low' || text === 'medium' || text === 'high') return text;
    if (text === 'warn' || text === 'warning') return 'medium';
    if (text === 'error' || text === 'danger' || text === 'critical') return 'high';
    return 'unknown';
}

/**
 * @param {string} intent
 * @param {number} timestamp
 * @returns {string}
 */
function createIntentId(intent, timestamp) {
    return `${timestamp.toString(36)}-${intent.length.toString(36)}-${Math.abs(hashString(intent)).toString(36)}`;
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
 *     intent: string;
 *     tool?: string | null;
 *     risk?: unknown;
 *     source?: string;
 *     toolCallId?: string | null;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalIntentEntry | null}
 */
export function appendTerminalIntent(input) {
    const intent = input.intent.trim();
    if (!intent) return null;
    const timestamp = input.timestamp ?? Date.now();
    const byteLength = utf8ByteLength(intent, 'terminal intent content');
    /** @type {TerminalIntentEntry} */
    const entry = {
        id: createIntentId(intent, timestamp),
        timestamp,
        intent,
        tool: input.tool?.trim() || null,
        risk: normalizeTerminalIntentRisk(input.risk),
        source: input.source ?? 'terminal.intent',
        toolCallId: input.toolCallId?.trim() || null,
        byteLength,
    };
    _terminalIntentHistory.push(entry);
    _terminalIntentBytes += byteLength;
    reduceIntentMemoryIfNeeded();
    return { ...entry };
}

/**
 * @param {number} [limit]
 * @returns {TerminalIntentEntry[]}
 */
export function readTerminalIntentHistory(limit) {
    const safeLimit =
        Number.isFinite(limit) && Number(limit) > 0 ? Math.floor(Number(limit)) : _terminalIntentHistory.length;
    return _terminalIntentHistory.slice(-safeLimit).map((entry) => ({ ...entry }));
}

/**
 * @returns {TerminalIntentEntry | null}
 */
export function readLatestTerminalIntent() {
    const entry = _terminalIntentHistory.at(-1) ?? null;
    return entry ? { ...entry } : null;
}

/**
 * @returns {{
 *     entries: number;
 *     bytes: number;
 *     softEntries: number;
 *     softBytes: number;
 *     catastrophicEntries: number;
 *     catastrophicBytes: number;
 *     memoryEvictions: number;
 *     heapPressure: number;
 * }}
 */
export function readTerminalIntentStats() {
    return {
        entries: _terminalIntentHistory.length,
        bytes: _terminalIntentBytes,
        softEntries: TERMINAL_INTENT_SOFT_ENTRIES,
        softBytes: TERMINAL_INTENT_SOFT_BYTES,
        catastrophicEntries: TERMINAL_INTENT_CATASTROPHIC_ENTRIES,
        catastrophicBytes: TERMINAL_INTENT_CATASTROPHIC_BYTES,
        memoryEvictions: _terminalIntentMemoryEvictions,
        heapPressure: readHeapPressure(),
    };
}

/** @returns {void} */
export function clearTerminalIntentHistory() {
    _terminalIntentHistory = [];
    _terminalIntentBytes = 0;
    _terminalIntentMemoryEvictions = 0;
}

export const __test__ = {
    clear: clearTerminalIntentHistory,
};
