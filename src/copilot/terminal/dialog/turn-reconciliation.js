// @ts-check
/**
 * Reconcilia texto publico ja exibido por streaming com a mensagem final do turno.
 *
 * O objetivo e impedir duplicacao: quando o SDK entrega deltas parciais e depois uma mensagem final completa, o
 * terminal deve imprimir apenas o sufixo ausente. Renderizacao completa fica reservada para ausencia de stream ou
 * divergencia real.
 *
 * @module copilot/terminal/dialog/turn-reconciliation
 */

import { measureVisibleTerminalChars, normalizeTerminalTranscriptText } from './turn-display.js';

/**
 * @typedef {'none' | 'full' | 'suffix'} TerminalFinalTranscriptRenderMode
 * @typedef {'already_streamed' | 'no_visible_stream' | 'stream_suffix' | 'stream_mismatch' | 'empty_reply'} TerminalFinalTranscriptRenderReason
 *
 * @typedef {{
 *     mode: TerminalFinalTranscriptRenderMode;
 *     reason: TerminalFinalTranscriptRenderReason;
 *     content: string;
 *     severity: 'info' | 'warn';
 * }} TerminalFinalTranscriptRenderDecision
 */

/**
 * @param {{
 *     reply: string | null;
 *     streamedContent: string;
 *     streamingStarted: boolean;
 *     streamingVisibleChars: number;
 * }} input
 * @returns {TerminalFinalTranscriptRenderDecision}
 */
export function decideFinalTranscriptRender(input) {
    const reply = typeof input.reply === 'string' ? input.reply : '';
    const finalNormalized = normalizeTerminalTranscriptText(reply);
    if (!finalNormalized) {
        return { mode: 'none', reason: 'empty_reply', content: '', severity: 'info' };
    }

    const streamedNormalized = normalizeTerminalTranscriptText(input.streamedContent);
    if (!input.streamingStarted || input.streamingVisibleChars <= 0 || streamedNormalized.length === 0) {
        return { mode: 'full', reason: 'no_visible_stream', content: reply, severity: 'info' };
    }

    if (finalNormalized === streamedNormalized) {
        return { mode: 'none', reason: 'already_streamed', content: '', severity: 'info' };
    }

    if (finalNormalized.startsWith(streamedNormalized)) {
        const suffix = finalNormalized.slice(streamedNormalized.length);
        if (measureVisibleTerminalChars(suffix) === 0) {
            return { mode: 'none', reason: 'already_streamed', content: '', severity: 'info' };
        }
        return { mode: 'suffix', reason: 'stream_suffix', content: suffix, severity: 'info' };
    }

    return { mode: 'full', reason: 'stream_mismatch', content: reply, severity: 'warn' };
}
