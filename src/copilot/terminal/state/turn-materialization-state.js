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

/**
 * @typedef {'terminal/explicit-turn' | 'sdk/assistant.turn_start' | 'sdk/assistant.message' | 'dialog/onDelta'} TerminalTurnMaterializationSource
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
 * @param {{ chunk: string; source?: string; timestamp?: number }} input
 * @returns {TerminalTurnMaterializedDelta | null}
 */
export function recordTerminalTurnDelta(input) {
    if (!input.chunk) return null;
    const timestamp = input.timestamp ?? Date.now();
    if (!_currentTurnMaterialization) {
        beginTerminalTurnMaterialization({ timestamp, source: 'dialog/onDelta' });
    }
    if (!_currentTurnMaterialization) return null;
    const entry = {
        chunk: input.chunk,
        source: input.source ?? 'dialog/onDelta',
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
