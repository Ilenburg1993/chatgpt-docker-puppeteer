// @ts-check
/**
 * Disposable BYOK streaming/delta probe.
 *
 * The chat probe validates that a model can answer. This probe validates whether the session path emits incremental
 * assistant deltas before/alongside the final assistant message, which is a separate UX-critical capability.
 *
 * @module copilot/model-gateway/probes/streaming-probe
 */

import { runConfiguredByokChatProbe } from './chat-probe.js';

const DEFAULT_STREAMING_PROBE_PROMPT =
    'Responda em exatamente tres segmentos curtos: STREAM_A, STREAM_B e STREAM_C. Nao use ferramentas e nao explique.';

/**
 * @param {Awaited<ReturnType<typeof runConfiguredByokChatProbe>>} chatResult
 * @returns {'ok' | 'no-delta' | 'unavailable' | 'admission-blocked' | 'empty' | 'failed'}
 */
function classifyStreamingStatus(chatResult) {
    if (chatResult.status !== 'ok') return chatResult.status;
    return chatResult.deltaCount > 0 && chatResult.deltaChars > 0 ? 'ok' : 'no-delta';
}

/**
 * @param {Parameters<typeof runConfiguredByokChatProbe>[0]} [options]
 */
export async function runConfiguredByokStreamingProbe(options = {}) {
    const chatResult = await runConfiguredByokChatProbe({
        ...options,
        prompt: options.prompt ?? DEFAULT_STREAMING_PROBE_PROMPT,
    });
    const status = classifyStreamingStatus(chatResult);
    return {
        ...chatResult,
        ok: status === 'ok',
        status,
        streamingProved: status === 'ok',
        errors:
            status === 'no-delta'
                ? [...chatResult.errors, 'Probe respondeu, mas não emitiu assistant.message_delta.']
                : chatResult.errors,
    };
}
