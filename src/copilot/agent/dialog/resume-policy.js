// @ts-check
/**
 * @module copilot/agent/dialog/resume-policy
 * @file Seleção da estratégia de resume do dialog loop.
 *
 *   O resultado desta policy é declarativo. O DialogLoopManager continua aplicando side effects como watchdog,
 *   persistência, métricas e chamada a `start()`.
 */

import { waitForEvent } from '#copilot/sdk';
import { EventEmitter } from 'node:events';
import { RESUME_QUESTION_WAIT_MS } from '../../config/agent.js';

/**
 * @typedef {import('../types.js').DialogLoopHost} AgentHost
 *
 * @typedef {'zero-pr-immediate' | 'zero-pr-preserved' | 'restart-with-pr'} DialogResumeStrategyKind
 *
 * @typedef {{
 *     kind: DialogResumeStrategyKind;
 *     prConsumed: boolean;
 *     persistenceLabel: string | null;
 *     persistenceDescription: string | null;
 *     logMessage: string;
 * }} DialogResumeStrategy
 */

/**
 * @param {unknown} candidate
 * @returns {candidate is EventEmitter}
 */
function isEventEmitterTarget(candidate) {
    return candidate instanceof EventEmitter;
}

/**
 * Decide a estratégia de resume do dialog loop.
 *
 * Estratégia A tenta preservar `ask_user` sem PR adicional; Estratégia B reinicia o boot prompt e consome 1 PR.
 *
 * @param {{
 *     host: AgentHost | null;
 *     fallbackTarget: EventEmitter;
 *     timeoutMs?: number;
 * }} input
 * @returns {Promise<DialogResumeStrategy>}
 */
export async function selectDialogResumeStrategy({ host, fallbackTarget, timeoutMs = RESUME_QUESTION_WAIT_MS }) {
    if (host?.hasPendingQuestion()) {
        return {
            kind: 'zero-pr-immediate',
            prConsumed: false,
            persistenceLabel: 'dialog.prMetrics.resume_zero_pr',
            persistenceDescription: 'Persist dialog loop PR metrics after zero-PR resume',
            logMessage: '[DialogLoopManager] ask_user já disponível — retomada zero-PR imediata.',
        };
    }

    const pendingTarget = isEventEmitterTarget(host) ? host : fallbackTarget;
    const preserved = await waitForEvent(pendingTarget, 'question.pending', { timeoutMs })
        .then(() => true)
        .catch(() => false);

    if (preserved) {
        return {
            kind: 'zero-pr-preserved',
            prConsumed: false,
            persistenceLabel: 'dialog.prMetrics.resume_preserved',
            persistenceDescription: 'Persist dialog loop PR metrics after preserved resume',
            logMessage: '[DialogLoopManager] ask_user preservado — retomada zero-PR.',
        };
    }

    return {
        kind: 'restart-with-pr',
        prConsumed: true,
        persistenceLabel: 'dialog.prMetrics.resume_with_pr',
        persistenceDescription: 'Persist dialog loop PR metrics after PR-consuming resume',
        logMessage: '[DialogLoopManager] ask_user não encontrado — reenviando boot prompt (1 PR).',
    };
}
