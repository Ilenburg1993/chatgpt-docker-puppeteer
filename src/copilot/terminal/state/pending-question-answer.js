// @ts-check
/**
 * @module copilot/terminal/pending-question-answer
 * @file Policy local para rotear input humano quando há pergunta pendente do runtime.
 */

import {
    answerTerminalPendingQuestion,
    hasTerminalPendingStructuredUserInputRequests,
    listTerminalPendingStructuredUserInputs,
    readTerminalRuntimeState,
} from '../frontend/gateways/index.js';

/**
 * @typedef {'answered' | 'answer_failed' | 'empty' | 'no_pending' | 'protocol_controlled' | 'invalid_choice'} TerminalPendingAnswerReason
 *
 *
 * @typedef {{
 *     routed: boolean;
 *     ok: boolean;
 *     reason: TerminalPendingAnswerReason;
 *     runtimeId: string | null;
 *     answer: string;
 *     pendingQuestionKind: import('../../presentation/contracts/index.js').RuntimePendingQuestionKind | null;
 *     pendingQuestionText: string | null;
 *     pendingQuestionChoices: string[];
 *     protocolControlled: boolean;
 *     shadowExpired: boolean;
 * }} TerminalPendingAnswerResult
 */

/**
 * @param {string} answer
 * @param {{ choices?: string[]; allowFreeform?: boolean }} pending
 * @returns {{ ok: true; answer: string } | { ok: false; reason: 'invalid_choice' }}
 */
function normalizePendingQuestionAnswer(answer, pending) {
    const choices = Array.isArray(pending.choices) ? pending.choices : [];
    if (choices.length === 0) {
        return { ok: true, answer };
    }
    const numericIndex = Number(answer);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= choices.length) {
        return { ok: true, answer: choices[numericIndex - 1] ?? answer };
    }
    if (choices.includes(answer)) {
        return { ok: true, answer };
    }
    const normalizedAnswer = answer.toLocaleLowerCase();
    const normalizedMatches = choices.filter((choice) => choice.toLocaleLowerCase() === normalizedAnswer);
    if (normalizedMatches.length === 1) {
        return { ok: true, answer: normalizedMatches[0] ?? answer };
    }
    if (pending.allowFreeform === false) {
        return { ok: false, reason: 'invalid_choice' };
    }
    return { ok: true, answer };
}

/**
 * Responde uma pergunta pendente apenas quando ela e uma pergunta humana real (`kind=question`).
 *
 * Perguntas de protocolo (`ready`, `reply`, `stopped`) continuam pelo fluxo normal de turno, pois o terminal precisa
 * manter callbacks de streaming/reply ativos para renderizar a resposta.
 *
 * @param {string} rawAnswer
 * @param {string | null | undefined} [runtimeId]
 * @param {{ allowProtocolControlled?: boolean }} [options]
 * @returns {TerminalPendingAnswerResult}
 */
export function tryAnswerTerminalPendingQuestionInput(rawAnswer, runtimeId, options = {}) {
    const answer = rawAnswer.trim();
    const runtimeState = readTerminalRuntimeState(runtimeId);
    const pending = runtimeState.pendingQuestion;
    const pendingQuestionKind = runtimeState.pendingQuestionKind;
    const pendingQuestionText = pending?.question ?? null;
    const pendingQuestionChoices = Array.isArray(pending?.choices) ? pending.choices : [];
    const protocolControlled = Boolean(pending?.protocolControlled || pendingQuestionKind !== 'question');
    const resultBase = {
        runtimeId: runtimeState.runtimeId ?? null,
        answer,
        pendingQuestionKind,
        pendingQuestionText,
        pendingQuestionChoices,
        protocolControlled,
        shadowExpired: Boolean(runtimeState.pendingQuestionShadowExpired),
    };

    if (!answer) {
        return { ...resultBase, routed: false, ok: false, reason: 'empty' };
    }
    if (!pending) {
        const structuredInputs = hasTerminalPendingStructuredUserInputRequests()
            ? listTerminalPendingStructuredUserInputs()
            : [];
        const structuredInput = structuredInputs[0] ?? null;
        if (structuredInput) {
            const normalized = normalizePendingQuestionAnswer(answer, structuredInput);
            const structuredBase = {
                ...resultBase,
                pendingQuestionText: structuredInput.question,
                pendingQuestionChoices: structuredInput.choices,
            };
            if (!normalized.ok) {
                return { ...structuredBase, routed: false, ok: false, reason: normalized.reason };
            }
            const ok = answerTerminalPendingQuestion(normalized.answer, runtimeId);
            return {
                ...structuredBase,
                answer: normalized.answer,
                routed: true,
                ok,
                reason: ok ? 'answered' : 'answer_failed',
            };
        }
        return { ...resultBase, routed: false, ok: false, reason: 'no_pending' };
    }
    if (protocolControlled && options.allowProtocolControlled !== true) {
        return { ...resultBase, routed: false, ok: false, reason: 'protocol_controlled' };
    }

    const normalized = normalizePendingQuestionAnswer(answer, pending);
    if (!normalized.ok) {
        return { ...resultBase, routed: false, ok: false, reason: normalized.reason };
    }

    const ok = answerTerminalPendingQuestion(normalized.answer, runtimeId);
    return { ...resultBase, answer: normalized.answer, routed: true, ok, reason: ok ? 'answered' : 'answer_failed' };
}

/**
 * Indica se uma linha humana ja pertenceu ao canal de pergunta pendente e, portanto, nao deve seguir para fila,
 * mailbox ou novo turno. Respostas invalidas tambem sao consumidas para manter a pergunta viva e dar feedback claro.
 *
 * @param {TerminalPendingAnswerResult} result
 * @returns {boolean}
 */
export function shouldConsumeTerminalPendingAnswerInput(result) {
    return result.routed || result.reason === 'invalid_choice';
}
