// @ts-check
/**
 * Materialização canônica de um turno explícito no terminal.
 *
 * Um turno da LLM-B pode chegar por fontes concorrentes: retorno direto do SDK, deltas incrementais, evento
 * `assistant.message` e eventos de ciclo (`turn_start`/`turn_end`). Este estado concentra essas fontes e resolve a
 * resposta textual por prioridade explícita, evitando fallbacks soltos no renderer.
 *
 * @module copilot/terminal/state/turn-materialization-state
 */

const MAX_ASSISTANT_MESSAGES_PER_TURN = 16;
const MAX_DELTA_SLICES_PER_TURN = 8192;
const RECENT_COMPLETED_TURNS_MAX = 32;
const RECENT_COMPLETED_TURN_TTL_MS = 5 * 60_000;

/**
 * @typedef {'terminal/explicit-turn' | 'sdk/assistant.turn_start' | 'sdk/assistant.message' | 'dialog/onDelta' | 'public-assistant-stream'} TerminalTurnMaterializationSource
 * @typedef {'active' | 'completed' | 'failed' | 'interrupted'} TerminalTurnMaterializationStatus
 * @typedef {'direct_reply' | 'assistant_message' | 'stream_delta' | 'empty'} TerminalTurnMaterializedSource
 *
 * @typedef {{
 *     content: string;
 *     kind: string;
 *     source: string;
 *     timestamp: number;
 * }} TerminalTurnMaterializedAssistantMessage
 *
 * @typedef {{
 *     chunk: string;
 *     source: string;
 *     sdkSource: string | null;
 *     streamId: string | null;
 *     chunkSeq: number | null;
 *     eventId: string | null;
 *     causationId: string | null;
 *     timestamp: number;
 * }} TerminalTurnMaterializedDelta
 *
 * @typedef {{
 *     turnKey: string;
 *     turnId: string | null;
 *     status: TerminalTurnMaterializationStatus;
 *     source: TerminalTurnMaterializationSource;
 *     startedAt: number;
 *     updatedAt: number;
 *     completedAt: number | null;
 *     assistantMessages: TerminalTurnMaterializedAssistantMessage[];
 *     deltaSlices: TerminalTurnMaterializedDelta[];
 *     deltaChars: number;
 *     droppedDeltaSlices: number;
 *     droppedDeltaChars: number;
 * }} TerminalTurnMaterializationSnapshot
 *
 * @typedef {TerminalTurnMaterializationSnapshot & { deltaText: string }} InternalTerminalTurnMaterialization
 *
 * @typedef {{
 *     reply: string | null;
 *     source: TerminalTurnMaterializedSource;
 *     sourceDetail: string;
 *     diagnostics: {
 *         hasDirectReply: boolean;
 *         assistantMessageCount: number;
 *         deltaChars: number;
 *         deltaSlices: number;
 *         droppedDeltaSlices: number;
 *         droppedDeltaChars: number;
 *     };
 *     snapshot: TerminalTurnMaterializationSnapshot | null;
 * }} TerminalTurnMaterializedReply
 */

/** @type {InternalTerminalTurnMaterialization | null} */
let _currentTurnMaterialization = null;

/** @type {{ turnKey: string; turnId: string | null; reply: string; deltaText: string; normalizedReply: string; normalizedDeltaText: string; completedAt: number }[]} */
const _recentCompletedTurnMaterializations = [];

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeTurnId(value) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

/**
 * @param {string | null} turnId
 * @param {number} timestamp
 * @returns {string}
 */
function createTurnKey(turnId, timestamp) {
    return turnId ? `turn:${turnId}` : `terminal:${timestamp}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeComparableTranscript(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Encontra o sufixo bruto de uma mensagem final preservando markdown/quebras originais.
 *
 * @param {string} finalContent
 * @param {string} alreadyRenderedContent
 * @returns {string | null}
 */
function findRawSuffixAfterRenderedPrefix(finalContent, alreadyRenderedContent) {
    const renderedNormalized = normalizeComparableTranscript(alreadyRenderedContent);
    if (!renderedNormalized) return null;
    for (let index = 0; index <= finalContent.length; index += 1) {
        if (normalizeComparableTranscript(finalContent.slice(0, index)) === renderedNormalized) {
            return finalContent.slice(index);
        }
    }
    return null;
}

/**
 * @param {number} [now]
 * @returns {void}
 */
function pruneRecentCompletedTurnMaterializations(now = Date.now()) {
    for (let i = _recentCompletedTurnMaterializations.length - 1; i >= 0; i -= 1) {
        const entry = _recentCompletedTurnMaterializations[i];
        if (!entry || now - entry.completedAt > RECENT_COMPLETED_TURN_TTL_MS) {
            _recentCompletedTurnMaterializations.splice(i, 1);
        }
    }
    if (_recentCompletedTurnMaterializations.length > RECENT_COMPLETED_TURNS_MAX) {
        _recentCompletedTurnMaterializations.length = RECENT_COMPLETED_TURNS_MAX;
    }
}

/**
 * @param {InternalTerminalTurnMaterialization} state
 * @returns {TerminalTurnMaterializationSnapshot}
 */
function snapshot(state) {
    return {
        turnKey: state.turnKey,
        turnId: state.turnId,
        status: state.status,
        source: state.source,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        completedAt: state.completedAt,
        assistantMessages: state.assistantMessages.map((entry) => ({ ...entry })),
        deltaSlices: state.deltaSlices.map((entry) => ({ ...entry })),
        deltaChars: state.deltaChars,
        droppedDeltaSlices: state.droppedDeltaSlices,
        droppedDeltaChars: state.droppedDeltaChars,
    };
}

/**
 * @param {{
 *     turnId?: string | number | null;
 *     timestamp?: number;
 *     source?: TerminalTurnMaterializationSource;
 * }} [input]
 * @returns {TerminalTurnMaterializationSnapshot}
 */
export function beginTerminalTurnMaterialization({
    turnId = null,
    timestamp = Date.now(),
    source = 'terminal/explicit-turn',
} = {}) {
    const normalizedTurnId = normalizeTurnId(turnId);
    if (_currentTurnMaterialization && _currentTurnMaterialization.status === 'active') {
        const canAttachTurnId =
            normalizedTurnId && (!_currentTurnMaterialization.turnId || _currentTurnMaterialization.turnId === '0');
        const sameTurn = normalizedTurnId && _currentTurnMaterialization.turnId === normalizedTurnId;
        const sdkStartForExplicitTurn =
            source === 'sdk/assistant.turn_start' && _currentTurnMaterialization.source === 'terminal/explicit-turn';
        if (canAttachTurnId || sameTurn || sdkStartForExplicitTurn) {
            if (canAttachTurnId) {
                _currentTurnMaterialization.turnId = normalizedTurnId;
                _currentTurnMaterialization.turnKey = createTurnKey(normalizedTurnId, timestamp);
            }
            _currentTurnMaterialization.source =
                _currentTurnMaterialization.source === 'terminal/explicit-turn'
                    ? _currentTurnMaterialization.source
                    : source;
            _currentTurnMaterialization.updatedAt = timestamp;
            return snapshot(_currentTurnMaterialization);
        }
    }

    _currentTurnMaterialization = {
        turnKey: createTurnKey(normalizedTurnId, timestamp),
        turnId: normalizedTurnId,
        status: 'active',
        source,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        assistantMessages: [],
        deltaSlices: [],
        deltaText: '',
        deltaChars: 0,
        droppedDeltaSlices: 0,
        droppedDeltaChars: 0,
    };
    return snapshot(_currentTurnMaterialization);
}

/**
 * @returns {void}
 */
export function clearTerminalTurnMaterialization() {
    _currentTurnMaterialization = null;
    _recentCompletedTurnMaterializations.length = 0;
}

/**
 * @returns {TerminalTurnMaterializationSnapshot | null}
 */
export function readTerminalTurnMaterialization() {
    return _currentTurnMaterialization ? snapshot(_currentTurnMaterialization) : null;
}

/**
 * @param {{ content: string; kind?: string; source?: string; timestamp?: number }} input
 * @returns {TerminalTurnMaterializedAssistantMessage | null}
 */
export function recordTerminalTurnAssistantMessage(input) {
    const content = input.content.trim();
    if (!content) return null;
    const timestamp = input.timestamp ?? Date.now();
    if (!_currentTurnMaterialization) {
        beginTerminalTurnMaterialization({ timestamp, source: 'sdk/assistant.message' });
    }
    if (!_currentTurnMaterialization) return null;
    const entry = {
        content,
        kind: input.kind ?? 'message',
        source: input.source ?? 'sdk/assistant.message',
        timestamp,
    };
    _currentTurnMaterialization.assistantMessages.push(entry);
    if (_currentTurnMaterialization.assistantMessages.length > MAX_ASSISTANT_MESSAGES_PER_TURN) {
        _currentTurnMaterialization.assistantMessages = _currentTurnMaterialization.assistantMessages.slice(
            -MAX_ASSISTANT_MESSAGES_PER_TURN,
        );
    }
    _currentTurnMaterialization.updatedAt = timestamp;
    return { ...entry };
}

/**
 * @param {{
 *     chunk: string;
 *     source?: string;
 *     sdkSource?: string | null;
 *     streamId?: string | null;
 *     chunkSeq?: number | null;
 *     eventId?: string | null;
 *     causationId?: string | null;
 *     timestamp?: number;
 * }} input
 * @returns {TerminalTurnMaterializedDelta | null}
 */
export function recordTerminalTurnDelta(input) {
    if (!input.chunk) return null;
    const timestamp = input.timestamp ?? Date.now();
    if (!_currentTurnMaterialization) {
        beginTerminalTurnMaterialization({
            timestamp,
            source: input.source === 'public-assistant-stream' ? 'public-assistant-stream' : 'dialog/onDelta',
        });
    }
    if (!_currentTurnMaterialization) return null;
    const entry = {
        chunk: input.chunk,
        source: input.source ?? 'dialog/onDelta',
        sdkSource: input.sdkSource ?? null,
        streamId: input.streamId ?? null,
        chunkSeq: input.chunkSeq ?? null,
        eventId: input.eventId ?? null,
        causationId: input.causationId ?? null,
        timestamp,
    };
    _currentTurnMaterialization.deltaText += input.chunk;
    _currentTurnMaterialization.deltaChars += input.chunk.length;
    _currentTurnMaterialization.deltaSlices.push(entry);
    if (_currentTurnMaterialization.deltaSlices.length > MAX_DELTA_SLICES_PER_TURN) {
        const dropped = _currentTurnMaterialization.deltaSlices.shift();
        _currentTurnMaterialization.droppedDeltaSlices++;
        _currentTurnMaterialization.droppedDeltaChars += dropped?.chunk.length ?? 0;
    }
    _currentTurnMaterialization.updatedAt = timestamp;
    return { ...entry };
}

/**
 * @param {{
 *     directReply?: string | null;
 *     directSource?: string | null;
 *     timestamp?: number;
 *     status?: TerminalTurnMaterializationStatus;
 * }} [input]
 * @returns {TerminalTurnMaterializedReply}
 */
export function completeTerminalTurnMaterialization({
    directReply = null,
    directSource = null,
    timestamp = Date.now(),
    status = 'completed',
} = {}) {
    const current = _currentTurnMaterialization;
    const direct = typeof directReply === 'string' && directReply.trim().length > 0 ? directReply : null;
    const latestAssistantMessage = current?.assistantMessages.at(-1) ?? null;
    const deltaText = current?.deltaText.trim().length ? current.deltaText.trimEnd() : null;
    /** @type {TerminalTurnMaterializedSource} */
    let source = 'empty';
    let sourceDetail = directSource ?? 'empty';
    /** @type {string | null} */
    let reply = null;

    if (direct) {
        reply = direct;
        source = 'direct_reply';
        sourceDetail = directSource ?? 'transport';
    } else if (latestAssistantMessage) {
        reply = latestAssistantMessage.content;
        source = 'assistant_message';
        sourceDetail = latestAssistantMessage.source;
    } else if (deltaText) {
        reply = deltaText;
        source = 'stream_delta';
        sourceDetail = 'dialog/onDelta';
    }

    if (current) {
        current.status = status;
        current.updatedAt = timestamp;
        current.completedAt = timestamp;
        const normalizedReply = normalizeComparableTranscript(reply);
        const normalizedDeltaText = normalizeComparableTranscript(current.deltaText);
        if (normalizedReply || normalizedDeltaText) {
            _recentCompletedTurnMaterializations.unshift({
                turnKey: current.turnKey,
                turnId: current.turnId,
                reply: reply ?? '',
                deltaText: current.deltaText,
                normalizedReply,
                normalizedDeltaText,
                completedAt: timestamp,
            });
            pruneRecentCompletedTurnMaterializations(timestamp);
        }
    }
    const materializedSnapshot = current ? snapshot(current) : null;
    _currentTurnMaterialization = null;
    return {
        reply,
        source,
        sourceDetail,
        diagnostics: {
            hasDirectReply: Boolean(direct),
            assistantMessageCount: current?.assistantMessages.length ?? 0,
            deltaChars: current?.deltaChars ?? 0,
            deltaSlices: current?.deltaSlices.length ?? 0,
            droppedDeltaSlices: current?.droppedDeltaSlices ?? 0,
            droppedDeltaChars: current?.droppedDeltaChars ?? 0,
        },
        snapshot: materializedSnapshot,
    };
}

/**
 * Decide como tratar uma `assistant.message` final quando já houve materialização parcial ou completa do mesmo turno.
 *
 * @param {{ content?: string | null | undefined; turnId?: string | number | null; now?: number }} input
 * @returns {{
 *     action: 'render_full' | 'render_suffix' | 'suppress';
 *     reason: 'empty' | 'no_materialization' | 'already_materialized' | 'stream_suffix' | 'stream_mismatch';
 *     suffix: string;
 *     matchedTurnKey: string | null;
 * }}
 */
export function getTerminalAssistantMessageMaterializationDecision({
    content,
    turnId = null,
    now = Date.now(),
}) {
    const finalContent = typeof content === 'string' ? content : '';
    const normalizedContent = normalizeComparableTranscript(finalContent);
    if (!normalizedContent) {
        return { action: 'suppress', reason: 'empty', suffix: '', matchedTurnKey: null };
    }
    const normalizedTurnId = normalizeTurnId(turnId);

    const decideFromEntry = (
        /** @type {{ turnKey: string; turnId: string | null; reply?: string; deltaText?: string; normalizedReply: string; normalizedDeltaText: string }} */ entry,
    ) => {
        if (normalizedTurnId && entry.turnId && normalizedTurnId !== entry.turnId) return null;
        if (entry.normalizedReply && entry.normalizedReply === normalizedContent) {
            return {
                action: /** @type {'suppress'} */ ('suppress'),
                reason: /** @type {'already_materialized'} */ ('already_materialized'),
                suffix: '',
                matchedTurnKey: entry.turnKey,
            };
        }
        if (
            entry.normalizedReply &&
            normalizedContent.length >= 24 &&
            entry.normalizedReply.includes(normalizedContent)
        ) {
            return {
                action: /** @type {'suppress'} */ ('suppress'),
                reason: /** @type {'already_materialized'} */ ('already_materialized'),
                suffix: '',
                matchedTurnKey: entry.turnKey,
            };
        }
        if (entry.normalizedDeltaText && entry.normalizedDeltaText === normalizedContent) {
            return {
                action: /** @type {'suppress'} */ ('suppress'),
                reason: /** @type {'already_materialized'} */ ('already_materialized'),
                suffix: '',
                matchedTurnKey: entry.turnKey,
            };
        }
        if (entry.normalizedDeltaText && normalizedContent.startsWith(entry.normalizedDeltaText)) {
            const suffix = findRawSuffixAfterRenderedPrefix(finalContent, entry.deltaText ?? entry.normalizedDeltaText);
            const renderableSuffix = (suffix ?? finalContent.slice(entry.normalizedDeltaText.length)).replace(/^\s+/, '');
            if (!normalizeComparableTranscript(renderableSuffix)) {
                return {
                    action: /** @type {'suppress'} */ ('suppress'),
                    reason: /** @type {'already_materialized'} */ ('already_materialized'),
                    suffix: '',
                    matchedTurnKey: entry.turnKey,
                };
            }
            return {
                action: /** @type {'render_suffix'} */ ('render_suffix'),
                reason: /** @type {'stream_suffix'} */ ('stream_suffix'),
                suffix: renderableSuffix,
                matchedTurnKey: entry.turnKey,
            };
        }
        if (
            entry.normalizedDeltaText &&
            normalizedContent.length >= 24 &&
            entry.normalizedDeltaText.includes(normalizedContent)
        ) {
            return {
                action: /** @type {'suppress'} */ ('suppress'),
                reason: /** @type {'already_materialized'} */ ('already_materialized'),
                suffix: '',
                matchedTurnKey: entry.turnKey,
            };
        }
        return null;
    };

    if (_currentTurnMaterialization) {
        const currentDecision = decideFromEntry({
            turnKey: _currentTurnMaterialization.turnKey,
            turnId: _currentTurnMaterialization.turnId,
            reply: '',
            deltaText: _currentTurnMaterialization.deltaText,
            normalizedReply: '',
            normalizedDeltaText: normalizeComparableTranscript(_currentTurnMaterialization.deltaText),
        });
        if (currentDecision) return currentDecision;
        if (normalizeComparableTranscript(_currentTurnMaterialization.deltaText)) {
            return {
                action: 'render_full',
                reason: 'stream_mismatch',
                suffix: '',
                matchedTurnKey: _currentTurnMaterialization.turnKey,
            };
        }
    }

    pruneRecentCompletedTurnMaterializations(now);
    for (const entry of _recentCompletedTurnMaterializations) {
        const decision = decideFromEntry(entry);
        if (decision) return decision;
    }
    return { action: 'render_full', reason: 'no_materialization', suffix: '', matchedTurnKey: null };
}

/**
 * Decide se um `assistant.message` do SDK já está coberto pela materialização canônica do turno.
 *
 * O SDK pode entregar a mesma fala pública por `assistant.message_delta`, retorno direto do turno e, logo depois,
 * `assistant.message`. A fonte canônica visual do terminal é o turno/delta já materializado; `assistant.message` deve
 * continuar arquivado em SSE, mas não abrir um segundo bloco visual nem trocar a atividade atual quando é equivalente.
 *
 * @param {{ content?: string | null | undefined; turnId?: string | number | null; now?: number }} input
 * @returns {boolean}
 */
export function shouldSuppressTerminalAssistantMessageAsMaterializedTurn({
    content,
    turnId = null,
    now = Date.now(),
}) {
    return (
        getTerminalAssistantMessageMaterializationDecision({ content, turnId, now }).action === 'suppress'
    );
}

/**
 * Decide se um `task.delta` tardio já foi coberto por `dialog.delta` no turno ativo.
 *
 * Esse caso aparece quando o SDK alimenta simultaneamente o loop explícito e a fila interna do agente. O renderer deve
 * continuar aceitando `task.delta` como fallback fora do dialog loop, mas durante um turno com deltas canônicos já
 * materializados ele não deve abrir atividade/transcript paralelo.
 *
 * @param {{ chunk?: string | null }} input
 * @returns {boolean}
 */
export function shouldSuppressTerminalTaskDeltaAsMaterializedDialog({ chunk }) {
    const normalizedChunk = normalizeComparableTranscript(chunk);
    if (!normalizedChunk || !_currentTurnMaterialization) return false;
    const hasDialogDelta = _currentTurnMaterialization.deltaSlices.some((entry) => entry.source === 'dialog/onDelta');
    if (!hasDialogDelta) return false;
    const normalizedDeltaText = normalizeComparableTranscript(_currentTurnMaterialization.deltaText);
    return Boolean(normalizedDeltaText && normalizedDeltaText.includes(normalizedChunk));
}

/**
 * @returns {TerminalTurnMaterializedAssistantMessage[]}
 */
export function readTerminalTurnAssistantMessages() {
    return _currentTurnMaterialization?.assistantMessages.map((entry) => ({ ...entry })) ?? [];
}

/**
 * Retorna a última mensagem textual capturada e limpa a materialização ativa.
 *
 * Mantido para compatibilidade com testes/callers antigos; novos fluxos devem usar
 * `completeTerminalTurnMaterialization`.
 *
 * @returns {TerminalTurnMaterializedAssistantMessage | null}
 */
export function takeLatestTerminalTurnAssistantMessage() {
    const latest = _currentTurnMaterialization?.assistantMessages.at(-1) ?? null;
    clearTerminalTurnMaterialization();
    return latest ? { ...latest } : null;
}
