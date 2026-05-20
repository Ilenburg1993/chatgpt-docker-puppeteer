// @ts-check
/**
 * Diagnostico canonico do streaming publico do terminal.
 *
 * A UX do terminal nao deve adivinhar se um delta sumiu, foi deduplicado, foi normalizado como snapshot cumulativo ou
 * se a resposta final precisou reconciliar um stream parcial. Este estado guarda essas decisoes de transporte para
 * `/activity`, `/metrics`, testes live e auditorias.
 */

const MAX_STREAM_DIAGNOSTIC_EVENTS = 80;

/**
 * @typedef {'accepted' | 'normalized' | 'suppressed'} TerminalStreamDeltaAction
 */

/**
 * @typedef {'raw'
 *     | 'causal_duplicate'
 *     | 'temporal_cross_channel'
 *     | 'cumulative_snapshot'
 *     | 'cumulative_prefix'
 *     | 'duplicate_suffix'
 *     | 'overlap_normalized'
 *     | 'human_answer_echo'
 *     | 'display_off'} TerminalStreamDeltaReason
 */

/**
 * @typedef {'none' | 'suffix' | 'full'} TerminalFinalReconciliationMode
 */

/**
 * @typedef {{
 *     kind: 'delta';
 *     action: TerminalStreamDeltaAction;
 *     reason: TerminalStreamDeltaReason;
 *     source: string;
 *     causalKey: string | null;
 *     rawChars: number;
 *     normalizedChars: number;
 *     streamId: string | null;
 *     chunkSeq: number | string | null;
 *     eventId: string | null;
 *     causationId: string | null;
 *     timestamp: number;
 * }} TerminalStreamDeltaDiagnosticEntry
 */

/**
 * @typedef {{
 *     kind: 'final';
 *     mode: TerminalFinalReconciliationMode;
 *     reason: string;
 *     source: string;
 *     streamedChars: number;
 *     streamingVisibleChars: number;
 *     finalChars: number;
 *     renderedChars: number;
 *     severity: 'info' | 'warn' | 'error';
 *     timestamp: number;
 * }} TerminalFinalReconciliationDiagnosticEntry
 */

/**
 * @typedef {TerminalStreamDeltaDiagnosticEntry | TerminalFinalReconciliationDiagnosticEntry} TerminalStreamDiagnosticEntry
 */

/**
 * @typedef {{
 *     deltaAccepted: number;
 *     deltaNormalized: number;
 *     deltaSuppressed: number;
 *     deltaCausalAccepted: number;
 *     deltaTemporalFallbackSuppressed: number;
 *     deltaCausalDuplicateSuppressed: number;
 *     deltaCumulativeNormalized: number;
 *     deltaCumulativeSuppressed: number;
 *     deltaOverlapNormalized: number;
 *     deltaDuplicateSuppressed: number;
 *     deltaHumanEchoSuppressed: number;
 *     deltaDisplayOff: number;
 *     finalAlreadyStreamed: number;
 *     finalSuffix: number;
 *     finalMismatch: number;
 *     finalNoVisibleStream: number;
 *     finalEmpty: number;
 * }} TerminalStreamDiagnosticCounters
 */
/** @type {TerminalStreamDiagnosticCounters} */
let _counters = createEmptyCounters();

/** @type {TerminalStreamDiagnosticEntry[]} */
let _events = [];

/**
 * @returns {TerminalStreamDiagnosticCounters}
 */
function createEmptyCounters() {
    return {
        deltaAccepted: 0,
        deltaNormalized: 0,
        deltaSuppressed: 0,
        deltaCausalAccepted: 0,
        deltaTemporalFallbackSuppressed: 0,
        deltaCausalDuplicateSuppressed: 0,
        deltaCumulativeNormalized: 0,
        deltaCumulativeSuppressed: 0,
        deltaOverlapNormalized: 0,
        deltaDuplicateSuppressed: 0,
        deltaHumanEchoSuppressed: 0,
        deltaDisplayOff: 0,
        finalAlreadyStreamed: 0,
        finalSuffix: 0,
        finalMismatch: 0,
        finalNoVisibleStream: 0,
        finalEmpty: 0,
    };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | string | null}
 */
function scalarOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.length > 0) return value;
    return null;
}

/**
 * @param {TerminalStreamDiagnosticEntry} entry
 * @returns {void}
 */
function pushEvent(entry) {
    _events.push(entry);
    if (_events.length > MAX_STREAM_DIAGNOSTIC_EVENTS) {
        _events = _events.slice(-MAX_STREAM_DIAGNOSTIC_EVENTS);
    }
}

/**
 * @param {{
 *     action: TerminalStreamDeltaAction;
 *     reason: TerminalStreamDeltaReason;
 *     source?: string;
 *     causalKey?: string | null;
 *     rawChars?: number;
 *     normalizedChars?: number;
 *     streamId?: unknown;
 *     chunkSeq?: unknown;
 *     eventId?: unknown;
 *     causationId?: unknown;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalStreamDeltaDiagnosticEntry}
 */
export function recordTerminalStreamDeltaDiagnostic(input) {
    const action = input.action;
    const reason = input.reason;
    if (action === 'accepted' && reason !== 'display_off') _counters.deltaAccepted += 1;
    if (action === 'normalized') _counters.deltaNormalized += 1;
    if (action === 'suppressed') _counters.deltaSuppressed += 1;
    if (action !== 'suppressed' && input.causalKey) _counters.deltaCausalAccepted += 1;
    if (reason === 'temporal_cross_channel') _counters.deltaTemporalFallbackSuppressed += 1;
    if (reason === 'causal_duplicate') _counters.deltaCausalDuplicateSuppressed += 1;
    if (reason === 'cumulative_snapshot' && action === 'normalized') _counters.deltaCumulativeNormalized += 1;
    if ((reason === 'cumulative_snapshot' || reason === 'cumulative_prefix') && action === 'suppressed') {
        _counters.deltaCumulativeSuppressed += 1;
    }
    if (reason === 'overlap_normalized') _counters.deltaOverlapNormalized += 1;
    if (reason === 'duplicate_suffix') _counters.deltaDuplicateSuppressed += 1;
    if (reason === 'human_answer_echo') _counters.deltaHumanEchoSuppressed += 1;
    if (reason === 'display_off') _counters.deltaDisplayOff += 1;

    /** @type {TerminalStreamDeltaDiagnosticEntry} */
    const entry = {
        kind: 'delta',
        action,
        reason,
        source: input.source ?? 'unknown',
        causalKey: input.causalKey ?? null,
        rawChars: Number(input.rawChars ?? 0),
        normalizedChars: Number(input.normalizedChars ?? 0),
        streamId: stringOrNull(input.streamId),
        chunkSeq: scalarOrNull(input.chunkSeq),
        eventId: stringOrNull(input.eventId),
        causationId: stringOrNull(input.causationId),
        timestamp: input.timestamp ?? Date.now(),
    };
    pushEvent(entry);
    return entry;
}

/**
 * @param {{
 *     mode: TerminalFinalReconciliationMode;
 *     reason: string;
 *     source?: string;
 *     streamedChars?: number;
 *     streamingVisibleChars?: number;
 *     finalChars?: number;
 *     renderedChars?: number;
 *     severity?: 'info' | 'warn' | 'error';
 *     timestamp?: number;
 * }} input
 * @returns {TerminalFinalReconciliationDiagnosticEntry}
 */
export function recordTerminalFinalReconciliationDiagnostic(input) {
    if (input.reason === 'already_streamed') _counters.finalAlreadyStreamed += 1;
    else if (input.reason === 'stream_suffix') _counters.finalSuffix += 1;
    else if (input.reason === 'stream_mismatch') _counters.finalMismatch += 1;
    else if (input.reason === 'no_visible_stream') _counters.finalNoVisibleStream += 1;
    else if (input.reason === 'empty_reply') _counters.finalEmpty += 1;

    /** @type {TerminalFinalReconciliationDiagnosticEntry} */
    const entry = {
        kind: 'final',
        mode: input.mode,
        reason: input.reason,
        source: input.source ?? 'dialog/final-reconciliation',
        streamedChars: Number(input.streamedChars ?? 0),
        streamingVisibleChars: Number(input.streamingVisibleChars ?? 0),
        finalChars: Number(input.finalChars ?? 0),
        renderedChars: Number(input.renderedChars ?? 0),
        severity: input.severity ?? (input.reason === 'stream_mismatch' ? 'warn' : 'info'),
        timestamp: input.timestamp ?? Date.now(),
    };
    pushEvent(entry);
    return entry;
}

/**
 * @param {number} [limit=10]
 * @returns {{
 *     counters: TerminalStreamDiagnosticCounters;
 *     recent: TerminalStreamDiagnosticEntry[];
 *     totals: {
 *         deltaDecisions: number;
 *         finalDecisions: number;
 *         suppressedRatio: number;
 *         normalizedRatio: number;
 *     };
 * }}
 */
export function readTerminalStreamDiagnosticsProjection(limit = 10) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const deltaDecisions = _counters.deltaAccepted + _counters.deltaNormalized + _counters.deltaSuppressed;
    const finalDecisions =
        _counters.finalAlreadyStreamed +
        _counters.finalSuffix +
        _counters.finalMismatch +
        _counters.finalNoVisibleStream +
        _counters.finalEmpty;
    return {
        counters: { ..._counters },
        recent: _events.slice(-safeLimit).reverse(),
        totals: {
            deltaDecisions,
            finalDecisions,
            suppressedRatio: deltaDecisions > 0 ? _counters.deltaSuppressed / deltaDecisions : 0,
            normalizedRatio: deltaDecisions > 0 ? _counters.deltaNormalized / deltaDecisions : 0,
        },
    };
}

/**
 * @returns {void}
 */
export function clearTerminalStreamDiagnosticsForTests() {
    _counters = createEmptyCounters();
    _events = [];
}
