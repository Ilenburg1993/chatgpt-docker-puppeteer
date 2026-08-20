// @ts-check
/**
 * src/copilot/terminal/dialog/turn-display.js
 *
 * Callbacks de renderização para streaming/reasoning durante turnos do dialog engine.
 *
 * @module copilot/terminal/dialog/turn-display
 * @see EventBus
 */

import { appendThinkingHistoryChunk, finalizeThinkingHistoryEntry } from '../../presentation/state/index.js';
import {
    formatTerminalThinkingRef,
    formatTerminalTimeLabel,
    readTerminalTurnCorrelation,
    recordTerminalActivity,
    recordTerminalStreamDeltaDiagnostic,
    terminalThemeDuration,
    terminalThemeHeadline,
    terminalThemeText,
    withTerminalTurnCorrelation,
} from '../state/dialog/index.js';
import {
    beginTerminalRenderLock,
    clearInlineStatus,
    endTerminalRenderLock,
    println,
    SEPARATOR,
    writeTerminalRaw,
} from './output.js';
import { broadcastSse } from './sse.js';

const TERMINAL_ESCAPE_SEQUENCE_RE = new RegExp(
    String.raw`\x1B(?:\][\s\S]*?(?:\x07|\x1B\\)|P[\s\S]*?\x1B\\|_[\s\S]*?\x1B\\|\^[\s\S]*?\x1B\\|X[\s\S]*?\x1B\\|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])`,
    'g',
);
const TERMINAL_UNSAFE_CONTROL_RE = new RegExp(String.raw`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`, 'g');
const PUBLIC_REASONING_BLOCK_RE =
    /^\s*(?:(?:<|&lt;)(thinking|analysis|reasoning)(?:>|&gt;)[\s\S]*?(?:<|&lt;)\/\1(?:>|&gt;)\s*)+/iu;
const PUBLIC_REASONING_OPEN_RE = /^\s*(?:<|&lt;)(?:thinking|analysis|reasoning)(?:>|&gt;)/iu;

/**
 * Estado mutável compartilhado entre os callbacks de reasoning e streaming.
 *
 * @typedef {Object} TurnDisplayState
 * @property {boolean} reasoningStarted
 * @property {number} reasoningChars
 * @property {string} reasoningContent
 * @property {string | null} reasoningId
 * @property {string | null} thinkingEntryId
 * @property {number} thinkingStartTime
 * @property {boolean} reasoningSummaryRendered
 * @property {number} lastReasoningProgressAt
 * @property {boolean} streamingStarted
 * @property {number} streamingChars
 * @property {string} streamingContent
 * @property {string} streamingPublicContent
 * @property {string} streamingBuffer
 * @property {boolean} streamingLineOpen
 * @property {number} streamingVisibleChars
 * @property {number} firstChunkTime
 * @property {number} turnStartTime
 * @property {string} model
 * @property {string} effort
 * @property {boolean} showThinking
 * @property {boolean} showStreaming
 * @property {number | null | undefined} [timeoutMs]
 * @property {'explicit' | 'adaptive' | 'disabled' | undefined} [timeoutStrategy]
 * @property {boolean} renderLockActive
 */

/**
 * Remove sequências ANSI e caracteres de controle que não representam conteúdo textual visível para o usuário.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripTerminalInvisibleText(text) {
    return String(text ?? '')
        .replace(TERMINAL_ESCAPE_SEQUENCE_RE, '')
        .replace(TERMINAL_UNSAFE_CONTROL_RE, '');
}

/**
 * Remove blocos de raciocínio que vazaram como texto público no começo da resposta.
 *
 * O SDK já fornece canais separados para reasoning; quando o provider devolve tags como `<thinking>` dentro do canal
 * público, o operador não deve receber esse conteúdo como fala da LLM-B. A regra é deliberadamente conservadora: só
 * remove blocos no início da mensagem, preservando exemplos literais que apareçam depois de texto público.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripPublicReasoningLeakText(text) {
    let current = stripTerminalInvisibleText(text);
    while (true) {
        const next = current.replace(PUBLIC_REASONING_BLOCK_RE, '');
        if (next === current) break;
        current = next;
    }
    if (PUBLIC_REASONING_OPEN_RE.test(current)) return '';
    return current;
}

/**
 * Sanitiza texto não confiável antes de renderizar no terminal. Deltas do modelo, tools e SDK não podem executar
 * sequências ANSI/OSC; newlines e tabs permanecem como conteúdo textual.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeTerminalRenderText(text) {
    return stripPublicReasoningLeakText(text).replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

/**
 * Mede quantos caracteres visíveis existem em um texto renderizado no terminal.
 *
 * @param {string} text
 * @returns {number}
 */
export function measureVisibleTerminalChars(text) {
    return stripTerminalInvisibleText(text).replace(/\s+/g, '').length;
}

/**
 * Normaliza texto para comparacao de integridade entre stream live e mensagem final.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeTerminalTranscriptText(text) {
    return stripTerminalInvisibleText(text).replace(/\r\n/g, '\n').trim();
}

/**
 * @param {TurnDisplayState} state
 * @param {string} reply
 * @returns {boolean}
 */
export function hasStreamingTranscriptMismatch(state, reply) {
    const streamed = normalizeTerminalTranscriptText(state.streamingContent);
    const finalReply = normalizeTerminalTranscriptText(reply);
    return streamed.length > 0 && finalReply.length > 0 && streamed !== finalReply;
}

/**
 * Cria estado inicial para display de turno.
 *
 * @param {{ model: string; effort: string; turnStartTime: number; showStreaming: boolean; showThinking: boolean }} opts
 * @returns {TurnDisplayState}
 */
export function createDisplayState({ model, effort, turnStartTime, showStreaming, showThinking }) {
    return {
        reasoningStarted: false,
        reasoningChars: 0,
        reasoningContent: '',
        reasoningId: null,
        thinkingEntryId: null,
        thinkingStartTime: Date.now(),
        reasoningSummaryRendered: false,
        lastReasoningProgressAt: 0,
        streamingStarted: false,
        streamingChars: 0,
        streamingContent: '',
        streamingPublicContent: '',
        streamingBuffer: '',
        streamingLineOpen: false,
        streamingVisibleChars: 0,
        firstChunkTime: 0,
        turnStartTime,
        model,
        effort,
        showThinking,
        showStreaming,
        renderLockActive: false,
    };
}

/**
 * @param {TurnDisplayState} state
 * @returns {void}
 */
function ensureRenderLock(state) {
    if (state.renderLockActive) return;
    beginTerminalRenderLock();
    state.renderLockActive = true;
}

/**
 * @param {TurnDisplayState} state
 * @returns {void}
 */
function releaseRenderLock(state) {
    if (!state.renderLockActive) return;
    endTerminalRenderLock();
    state.renderLockActive = false;
}

/**
 * @param {TurnDisplayState} state
 * @returns {string}
 */
function getThinkingEntryId(state) {
    return state.thinkingEntryId ?? `dialog-${state.reasoningId ?? state.turnStartTime}`;
}

/**
 * @param {TurnDisplayState} state
 * @returns {void}
 */
function flushReasoningSummary(state) {
    if (!state.reasoningStarted || state.reasoningSummaryRendered) return;
    const durationMs = Date.now() - state.thinkingStartTime;
    const entry = finalizeThinkingHistoryEntry(getThinkingEntryId(state), { durationMs, status: 'completed' });
    const shortId = formatTerminalThinkingRef(entry?.id ?? getThinkingEntryId(state));

    if (state.showThinking) {
        writeTerminalRaw('\x1b[0m\n');
        println(
            `  ${terminalThemeText('thinking', `└── raciocínio #${shortId}`)}  ${terminalThemeText('muted', `${(durationMs / 1000).toFixed(1)}s · ${state.reasoningChars} ${state.reasoningChars === 1 ? 'caractere' : 'caracteres'} · ${state.model}/${state.effort}`)}`,
        );
        println(
            `  ${terminalThemeText('muted', '    conteúdo de reasoning não é despejado automaticamente; acompanhe o estado pela linha viva.')}`,
        );
        println(`  ${terminalThemeText('muted', `    /thinking latest  ·  id ${shortId}`)}`);
        println('');
    }
    broadcastSse(
        'reasoning.complete',
        withTerminalTurnCorrelation({
            content: state.reasoningContent,
            reasoningId: state.reasoningId,
            durationMs,
            chars: state.reasoningChars,
            source: 'terminal-turn-display/reasoning.complete',
            timestamp: Date.now(),
        }),
    );
    state.reasoningSummaryRendered = true;
}

/**
 * Cria callback de reasoning para display de pensamento.
 *
 * @param {TurnDisplayState} state
 * @returns {(chunk: string, reasoningId: string | null) => void}
 */
export function createReasoningCallback(state) {
    return (chunk, rId) => {
        if (!state.reasoningStarted) {
            state.reasoningStarted = true;
            state.reasoningId = rId;
            state.thinkingEntryId = `dialog-${rId ?? state.turnStartTime}`;
            ensureRenderLock(state);
            recordTerminalActivity('thinking', 'Raciocinando', {
                detail: `${state.model} · ${state.effort}`,
                source: 'dialog',
            });
            if (state.showThinking) {
                const tsNow = formatTerminalTimeLabel(Date.now(), { mode: 'dual' });
                println(SEPARATOR);
                println(
                    terminalThemeHeadline('thinking', 'Raciocínio capturado', [
                        `[${tsNow}]`,
                        state.model,
                        state.effort,
                    ]),
                );
                println('');
            }
        }
        state.reasoningChars += chunk.length;
        state.reasoningContent += chunk;
        appendThinkingHistoryChunk({
            id: getThinkingEntryId(state),
            source: 'dialog',
            title: `LLM-B · ${state.model} · ${state.effort}`,
            chunk,
            reasoningId: rId,
            model: state.model,
            effort: state.effort,
        });
        if (state.showThinking) {
            const now = Date.now();
            if (now - state.lastReasoningProgressAt >= 1_000) {
                state.lastReasoningProgressAt = now;
                recordTerminalActivity('thinking', 'Raciocinando', {
                    detail: `${state.reasoningChars} ${state.reasoningChars === 1 ? 'caractere' : 'caracteres'} capturados · ${state.model}/${state.effort}`,
                    source: 'dialog',
                    recordHistory: false,
                });
            }
        }
        broadcastSse(
            'reasoning',
            withTerminalTurnCorrelation({
                chunk,
                reasoningId: rId,
                source: 'terminal-turn-display/reasoning',
                timestamp: Date.now(),
            }),
        );
    };
}

/**
 * @param {TurnDisplayState} state
 * @param {{ force?: boolean }} [opts]
 * @returns {void}
 */
function flushStreamingBuffer(state, opts = {}) {
    if (!state.streamingBuffer) return;
    if (!opts.force && !state.streamingStarted) return;
    writeStreamingText(state, state.streamingBuffer);
    state.streamingBuffer = '';
}

/**
 * Escreve streaming preservando uma única margem visual por linha real. O SDK pode entregar chunks pequenos; prefixar
 * cada flush criaria `│` no meio das frases.
 *
 * @param {TurnDisplayState} state
 * @param {string} text
 * @returns {void}
 */
function writeStreamingText(state, text) {
    const safeText = sanitizeTerminalRenderText(text);
    state.streamingVisibleChars += measureVisibleTerminalChars(safeText);
    const prefix = `  ${terminalThemeText('success', '│')}  `;
    let rest = safeText;
    while (rest.length > 0) {
        if (!state.streamingLineOpen) {
            writeTerminalRaw(prefix);
            state.streamingLineOpen = true;
        }
        const newlineIndex = rest.indexOf('\n');
        if (newlineIndex === -1) {
            writeTerminalRaw(rest);
            return;
        }
        writeTerminalRaw(rest.slice(0, newlineIndex + 1));
        state.streamingLineOpen = false;
        rest = rest.slice(newlineIndex + 1);
    }
}

/**
 * Cria callback de streaming delta para display de resposta.
 *
 * @param {TurnDisplayState} state
 * @returns {(chunk: string, envelope?: Record<string, unknown>) => void}
 */
export function createDeltaCallback(state) {
    return (chunk, envelope = {}) => {
        const now = Date.now();
        if (state.firstChunkTime === 0) {
            state.firstChunkTime = now;
        }
        state.streamingChars += chunk.length;
        state.streamingContent += chunk;
        const correlation = readTerminalTurnCorrelation();
        const publicContent = sanitizeTerminalRenderText(state.streamingContent);
        const publicChunk = publicContent.startsWith(state.streamingPublicContent)
            ? publicContent.slice(state.streamingPublicContent.length)
            : publicContent;
        state.streamingPublicContent = publicContent;
        broadcastSse('delta', {
            chunk,
            publicChunk,
            ...(correlation.traceId ? { traceId: correlation.traceId } : {}),
            ...(correlation.turnId ? { turnId: correlation.turnId } : {}),
            source: typeof envelope['source'] === 'string' ? envelope['source'] : 'terminal-turn-display/delta',
            ...(typeof envelope['streamId'] === 'string' ? { streamId: envelope['streamId'] } : {}),
            ...(typeof envelope['chunkSeq'] === 'number' ? { chunkSeq: envelope['chunkSeq'] } : {}),
            ...(typeof envelope['eventId'] === 'string' ? { eventId: envelope['eventId'] } : {}),
            ...(typeof envelope['causationId'] === 'string' ? { causationId: envelope['causationId'] } : {}),
            ...(typeof envelope['ts'] === 'number' ? { ts: envelope['ts'] } : {}),
            timestamp: now,
        });

        if (!state.showStreaming) {
            recordTerminalStreamDeltaDiagnostic({
                action: 'accepted',
                reason: 'display_off',
                source: typeof envelope['source'] === 'string' ? envelope['source'] : 'dialog/render',
                rawChars: chunk.length,
                normalizedChars: chunk.length,
                traceId: correlation.traceId,
                turnId: correlation.turnId,
                streamId: envelope['streamId'],
                chunkSeq: envelope['chunkSeq'],
                eventId: envelope['eventId'],
                causationId: envelope['causationId'],
            });
            recordTerminalActivity('streaming', 'Gerando resposta', {
                detail: `${state.model} · ${state.effort}`,
                source: 'dialog',
                recordHistory: false,
            });
            return;
        }

        state.streamingBuffer += chunk;

        if (
            !state.streamingStarted &&
            measureVisibleTerminalChars(sanitizeTerminalRenderText(state.streamingBuffer)) > 0
        ) {
            state.streamingStarted = true;
            state.firstChunkTime = state.firstChunkTime || Date.now();
            ensureRenderLock(state);
            recordTerminalActivity('streaming', 'Transmitindo resposta', {
                detail: `${state.model} · ${state.effort}`,
                source: 'dialog',
            });
            if (state.reasoningStarted) {
                flushReasoningSummary(state);
            } else {
                clearInlineStatus();
            }
            writeTerminalRaw('', { clearPromptLine: true });
            const tsNow = formatTerminalTimeLabel(now, { mode: 'dual' });
            println(SEPARATOR);
            println(terminalThemeHeadline('assistant', 'LLM-B', [`[${tsNow}]`, state.model, state.effort]));
            println('');
        }

        if (state.streamingStarted) {
            flushStreamingBuffer(state);
        }
    };
}

/**
 * Renderiza footer com duração e TTFT após streaming completo.
 *
 * @param {TurnDisplayState} state
 * @param {number} durationMs
 */
export function renderStreamingFooter(state, durationMs) {
    if (state.firstChunkTime > 0) {
        recordTerminalActivity('system', 'Resposta concluída', {
            detail: `${(durationMs / 1000).toFixed(1)}s`,
            source: 'dialog',
        });
    }
    if (state.streamingStarted) {
        flushStreamingBuffer(state, { force: true });
        const ttft =
            state.firstChunkTime > 0 ? ((state.firstChunkTime - state.turnStartTime) / 1000).toFixed(1) + 's TTFT' : '';
        writeTerminalRaw('\n');
        println(
            `  ${terminalThemeText('muted', '└──')} ${terminalThemeDuration(durationMs)}${ttft ? `  ${terminalThemeText('muted', '·')}  ${terminalThemeText('muted', ttft)}` : ''}`,
        );
        println('');
    }

    if (state.reasoningStarted && !state.streamingStarted) {
        flushReasoningSummary(state);
    }
    releaseRenderLock(state);
}

/**
 * Libera recursos visuais de um turno mesmo quando o SDK falha antes do footer normal.
 *
 * @param {TurnDisplayState | null | undefined} state
 * @returns {void}
 */
export function releaseDisplayState(state) {
    if (!state) return;
    flushStreamingBuffer(state, { force: true });
    releaseRenderLock(state);
}
