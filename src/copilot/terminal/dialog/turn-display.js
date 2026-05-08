// @ts-check
/**
 * src/copilot/terminal/dialog/turn-display.js
 *
 * Callbacks de renderização para streaming/reasoning durante turnos do dialog engine.
 *
 * @module copilot/terminal/dialog/turn-display
 * @see EventBus
 */

import { appendThinkingHistoryChunk, finalizeThinkingHistoryEntry } from '../../presentation/runtime-ui-state-store.js';
import { recordTerminalActivity } from '../activity-state.js';
import { terminalThemeText } from '../ui-theme.js';
import {
    beginTerminalRenderLock,
    clearInlineStatus,
    endTerminalRenderLock,
    println,
    SEPARATOR,
    writeTerminalRaw,
} from './output.js';
import { broadcastSse } from './sse.js';

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
 * @property {string} streamingBuffer
 * @property {boolean} streamingLineOpen
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
        streamingBuffer: '',
        streamingLineOpen: false,
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
    const shortId = (entry?.id ?? getThinkingEntryId(state)).slice(-12);

    if (state.showThinking) {
        writeTerminalRaw('\x1b[0m\n');
        println(
            `  ${terminalThemeText('thinking', `└── thinking #${shortId}`)}  ${terminalThemeText('muted', `${(durationMs / 1000).toFixed(1)}s · ${state.reasoningChars} chars · ${state.model}/${state.effort}`)}`,
        );
        println(
            `  ${terminalThemeText('muted', '    conteúdo de reasoning não é despejado automaticamente; acompanhe o estado pela linha viva.')}`,
        );
        println(`  ${terminalThemeText('muted', `    /thinking latest  ·  id ${shortId}`)}`);
        println('');
    }
    broadcastSse('reasoning.complete', {
        content: state.reasoningContent,
        reasoningId: state.reasoningId,
        durationMs,
        chars: state.reasoningChars,
    });
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
                const tsNow = new Date().toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                });
                println(SEPARATOR);
                println(
                    `  ${terminalThemeText('muted', `[${tsNow}]`)}  💭  ${terminalThemeText('thinking', 'Thinking capturado')}  ${terminalThemeText('muted', `· ${state.model} · ${state.effort}`)}`,
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
                    detail: `${state.reasoningChars} chars capturados · ${state.model}/${state.effort}`,
                    source: 'dialog',
                    recordHistory: false,
                });
            }
        }
        broadcastSse('reasoning', { chunk, reasoningId: rId });
    };
}

/**
 * @param {TurnDisplayState} state
 * @param {{ force?: boolean }} [opts]
 * @returns {void}
 */
function flushStreamingBuffer(state, opts = {}) {
    if (!state.streamingBuffer) return;
    if (!opts.force && state.streamingBuffer.length < 48 && !/[\n.!?:;]\s*$/.test(state.streamingBuffer)) return;
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
    const prefix = `  ${terminalThemeText('success', '│')}  `;
    let rest = text;
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
 * @returns {(chunk: string) => void}
 */
export function createDeltaCallback(state) {
    return (chunk) => {
        if (state.firstChunkTime === 0) {
            state.firstChunkTime = Date.now();
        }
        state.streamingChars += chunk.length;
        broadcastSse('delta', { chunk });

        if (!state.showStreaming) {
            recordTerminalActivity('streaming', 'Gerando resposta', {
                detail: `${state.model} · ${state.effort}`,
                source: 'dialog',
                recordHistory: false,
            });
            return;
        }

        if (!state.streamingStarted) {
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
            const tsNow = new Date().toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            println(SEPARATOR);
            println(
                `  ${terminalThemeText('muted', `[${tsNow}]`)}  🧠  ${terminalThemeText('success', 'LLM-B')}  ${terminalThemeText('muted', '·')}  ${terminalThemeText('info', state.model)}  ${terminalThemeText('muted', '·')}  ${terminalThemeText('thinking', state.effort)}`,
            );
            println('');
        }
        state.streamingBuffer += chunk;
        flushStreamingBuffer(state);
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
        const secs = (durationMs / 1000).toFixed(1);
        const secsNum = durationMs / 1000;
        const secsColor =
            secsNum < 5
                ? `\x1b[32m${secs}s\x1b[0m`
                : secsNum < 15
                  ? `\x1b[33m${secs}s\x1b[0m`
                  : `\x1b[31m${secs}s\x1b[0m`;
        const ttft =
            state.firstChunkTime > 0 ? ((state.firstChunkTime - state.turnStartTime) / 1000).toFixed(1) + 's TTFT' : '';
        writeTerminalRaw('\n');
        println(`  \x1b[90m└── ${secsColor}${ttft ? `  \x1b[90m·\x1b[0m  \x1b[90m${ttft}\x1b[0m` : ''}\x1b[0m`);
        println('');
    }

    if (state.reasoningStarted && !state.streamingStarted) {
        flushReasoningSummary(state);
    }
    releaseRenderLock(state);
}
