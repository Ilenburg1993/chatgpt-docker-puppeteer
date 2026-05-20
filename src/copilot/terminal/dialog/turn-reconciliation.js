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
 * Encontra o índice bruto em `reply` imediatamente após o prefixo já transmitido, preservando Markdown, quebras e
 * espaços do sufixo original. O comparador normalizado decide equivalência; a renderização nunca deve usar o texto
 * normalizado como conteúdo final.
 *
 * @param {string} reply
 * @param {string} streamedNormalized
 * @returns {number | null}
 */
function findRawSuffixStart(reply, streamedNormalized) {
    for (let index = 0; index <= reply.length; index += 1) {
        if (normalizeTerminalTranscriptText(reply.slice(0, index)) === streamedNormalized) return index;
    }
    return null;
}

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
        const rawSuffixStart = findRawSuffixStart(reply, streamedNormalized);
        const suffix = rawSuffixStart === null ? reply.slice(streamedNormalized.length) : reply.slice(rawSuffixStart);
        if (measureVisibleTerminalChars(suffix) === 0) {
            return { mode: 'none', reason: 'already_streamed', content: '', severity: 'info' };
        }
        return { mode: 'suffix', reason: 'stream_suffix', content: suffix, severity: 'info' };
    }

    return { mode: 'full', reason: 'stream_mismatch', content: reply, severity: 'warn' };
}
