// @ts-check
/**
 * @module copilot/terminal/pending-question-replay
 * @file Policy local para replay/dedupe de perguntas pendentes no terminal.
 */

import { DialogProtocol } from '../../dialog/protocol.js';

/**
 * @typedef {'event' | 'replay'} TerminalPendingQuestionSource
 *
 * @typedef {{
 *     render: boolean;
 *     reason: 'empty' | 'protocol' | 'duplicate' | null;
 *     key: string | null;
 * }} TerminalPendingQuestionRenderDecision
 */

const DEFAULT_DEDUPE_TTL_MS = 30 * 60_000;

/**
 * @param {string} question
 * @param {string[]} [choices=[]] Default is `[]`
 * @returns {string}
 */
export function buildTerminalPendingQuestionReplayKey(question, choices = []) {
    return `${question.trim().replace(/\s+/g, ' ')}::${choices.map((choice) => choice.trim()).join('|')}`;
}

/**
 * @param {{ ttlMs?: number }} [options]
 * @returns {{
 *     shouldRender: (input: {
 *         question: string;
 *         choices?: string[];
 *         source?: TerminalPendingQuestionSource;
 *         now?: number;
 *     }) => TerminalPendingQuestionRenderDecision;
 * }}
 */
export function createTerminalPendingQuestionReplayState(options = {}) {
    const ttlMs =
        Number.isFinite(options.ttlMs) && Number(options.ttlMs) >= 0 ? Number(options.ttlMs) : DEFAULT_DEDUPE_TTL_MS;
    /** @type {string | null} */
    let lastKey = null;
    let lastRenderedAt = 0;

    return {
        shouldRender({ question, choices = [], now = Date.now() }) {
            const normalizedQuestion = question.trim();
            if (!normalizedQuestion) {
                return { render: false, reason: 'empty', key: null };
            }
            if (DialogProtocol.isProtocolMessage(normalizedQuestion)) {
                return { render: false, reason: 'protocol', key: null };
            }
            const key = buildTerminalPendingQuestionReplayKey(normalizedQuestion, choices);
            if (lastKey === key && now - lastRenderedAt <= ttlMs) {
                return { render: false, reason: 'duplicate', key };
            }
            lastKey = key;
            lastRenderedAt = now;
            return { render: true, reason: null, key };
        },
    };
}
