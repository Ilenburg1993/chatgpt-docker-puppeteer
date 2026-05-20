// @ts-check
/**
 * Renderizador canônico de texto público incremental da LLM-B fora de um turno explícito.
 *
 * O SDK 0.3.x separa `assistant.message_delta` (texto público) de `assistant.reasoning_delta`
 * (thinking). Este módulo renderiza apenas o texto público. O thinking segue restrito ao histórico
 * consultável por `/thinking`.
 *
 * @module copilot/terminal/events/public-assistant-stream
 */

import { getShowStreaming } from '../../presentation/state/index.js';
import { readTerminalDialogStreamMeta } from '../frontend/gateways/index.js';
import { createDeltaCallback, createDisplayState, renderStreamingFooter } from '../dialog/index.js';

/**
 * @typedef {{
 *     state: import('../dialog/turn-display.js').TurnDisplayState;
 *     startedAt: number;
 * }} PublicAssistantStream
 */

/** @type {Map<string, PublicAssistantStream>} */
const streams = new Map();

/**
 * @param {string | null | undefined} key
 * @returns {string}
 */
function normalizeStreamKey(key) {
    return typeof key === 'string' && key.trim().length > 0 ? key : 'terminal-public-assistant-stream';
}

/**
 * @param {string} streamKey
 * @returns {PublicAssistantStream}
 */
function getOrCreateStream(streamKey) {
    const current = streams.get(streamKey);
    if (current) return current;

    const { model, reasoningEffort } = readTerminalDialogStreamMeta();
    const startedAt = Date.now();
    const stream = {
        state: createDisplayState({
            model,
            effort: reasoningEffort,
            turnStartTime: startedAt,
            showStreaming: getShowStreaming(),
            showThinking: false,
        }),
        startedAt,
    };
    streams.set(streamKey, stream);
    return stream;
}

/**
 * @param {{ key?: string | null; chunk: string }} input
 * @returns {{ liveRendered: boolean }}
 */
export function renderPublicAssistantStreamDelta(input) {
    const chunk = input.chunk;
    if (!chunk) return { liveRendered: false };
    const streamKey = normalizeStreamKey(input.key);
    const stream = getOrCreateStream(streamKey);
    const renderDelta = createDeltaCallback(stream.state);
    renderDelta(chunk);
    return { liveRendered: stream.state.streamingStarted };
}

/**
 * @param {{ key?: string | null }} input
 * @returns {{ liveRendered: boolean }}
 */
export function finalizePublicAssistantStream(input = {}) {
    const streamKey = normalizeStreamKey(input.key);
    const stream = streams.get(streamKey);
    if (!stream) return { liveRendered: false };
    streams.delete(streamKey);
    const liveRendered = stream.state.streamingStarted;
    renderStreamingFooter(stream.state, Date.now() - stream.startedAt);
    return { liveRendered };
}

/**
 * @returns {string[]}
 */
export function finalizeAllPublicAssistantStreams() {
    const keys = [...streams.keys()];
    for (const key of keys) {
        finalizePublicAssistantStream({ key });
    }
    return keys;
}

/**
 * @returns {void}
 */
export function resetPublicAssistantStreamsForTests() {
    streams.clear();
}
