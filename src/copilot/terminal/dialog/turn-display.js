// @ts-check
/**
 * src/copilot/terminal/dialog/turn-display.js
 *
 * Callbacks de renderização para streaming/reasoning durante turnos do dialog engine.
 *
 * @module copilot/terminal/dialog/turn-display
 * @see EventBus
 */

import { recordTerminalActivity } from '../activity-state.js';
import { SEPARATOR, println } from './output.js';
import { broadcastSse } from './sse.js';

/**
 * Estado mutável compartilhado entre os callbacks de reasoning e streaming.
 *
 * @typedef {Object} TurnDisplayState
 * @property {boolean} reasoningStarted
 * @property {number} reasoningChars
 * @property {string} reasoningContent
 * @property {string | null} reasoningId
 * @property {number} thinkingStartTime
 * @property {boolean} streamingStarted
 * @property {number} streamingChars
 * @property {number} firstChunkTime
 * @property {number} turnStartTime
 * @property {string} model
 * @property {string} effort
 * @property {boolean} showStreaming
 */

/**
 * Cria estado inicial para display de turno.
 *
 * @param {{ model: string; effort: string; turnStartTime: number; showStreaming: boolean }} opts
 * @returns {TurnDisplayState}
 */
export function createDisplayState({ model, effort, turnStartTime, showStreaming }) {
    return {
        reasoningStarted: false,
        reasoningChars: 0,
        reasoningContent: '',
        reasoningId: null,
        thinkingStartTime: Date.now(),
        streamingStarted: false,
        streamingChars: 0,
        firstChunkTime: 0,
        turnStartTime,
        model,
        effort,
        showStreaming,
    };
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
            recordTerminalActivity('thinking', 'Raciocinando', {
                detail: `${state.model} · ${state.effort}`,
                source: 'dialog',
            });
            process.stdout.write('\r\x1b[K');
            const tsNow = new Date().toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            println(SEPARATOR);
            println(`  \x1b[90m[${tsNow}]\x1b[0m  💭  \x1b[2m\x1b[35mpensando…\x1b[0m`);
            println('');
            process.stdout.write('  \x1b[2m\x1b[90m│\x1b[0m  \x1b[2m\x1b[37m');
        }
        state.reasoningChars += chunk.length;
        state.reasoningContent += chunk;
        const lines = chunk.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) process.stdout.write('\n  \x1b[2m\x1b[90m│\x1b[0m  \x1b[2m\x1b[37m');
            process.stdout.write(/** @type {string} */ (lines[i]));
        }
        broadcastSse('reasoning', { chunk, reasoningId: rId });
    };
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
            recordTerminalActivity('streaming', 'Transmitindo resposta', {
                detail: `${state.model} · ${state.effort}`,
                source: 'dialog',
            });
            if (state.reasoningStarted) {
                process.stdout.write('\x1b[0m\n');
                const thinkSecs = ((Date.now() - state.thinkingStartTime) / 1000).toFixed(1);
                println(`  \x1b[90m└── pensamento completo (${thinkSecs}s · ${state.reasoningChars} chars)\x1b[0m`);
                println('');
                broadcastSse('reasoning.complete', {
                    content: state.reasoningContent,
                    reasoningId: state.reasoningId,
                    durationMs: Date.now() - state.thinkingStartTime,
                    chars: state.reasoningChars,
                });
            } else {
                process.stdout.write('\r\x1b[K');
            }
            const tsNow = new Date().toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            println(SEPARATOR);
            println(
                `  \x1b[90m[${tsNow}]\x1b[0m  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m·\x1b[0m  \x1b[36m${state.model}\x1b[0m  \x1b[90m·\x1b[0m  \x1b[35m${state.effort}\x1b[0m`,
            );
            println('');
            process.stdout.write('  \x1b[32m│\x1b[0m  ');
        }
        const lines = chunk.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) process.stdout.write('\n  \x1b[32m│\x1b[0m  ');
            process.stdout.write(/** @type {string} */ (lines[i]));
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
        process.stdout.write('\n');
        println(`  \x1b[90m└── ${secsColor}${ttft ? `  \x1b[90m·\x1b[0m  \x1b[90m${ttft}\x1b[0m` : ''}\x1b[0m`);
        println('');
    }

    if (state.reasoningStarted && !state.streamingStarted) {
        process.stdout.write('\x1b[0m\n');
        const thinkSecs = ((Date.now() - state.thinkingStartTime) / 1000).toFixed(1);
        println(`  \x1b[90m└── pensamento completo (${thinkSecs}s · ${state.reasoningChars} chars)\x1b[0m`);
        println('');
        broadcastSse('reasoning.complete', {
            content: state.reasoningContent,
            reasoningId: state.reasoningId,
            durationMs: Date.now() - state.thinkingStartTime,
            chars: state.reasoningChars,
        });
    }
}
