// @ts-check
/**
 * @module copilot/agent/dialog/resume-policy
 * @file Seleção da estratégia de resume do dialog loop.
 *
 *   O resultado desta policy é declarativo. O DialogLoopManager continua aplicando side effects como watchdog,
 *   persistência, métricas e chamada a `start()`.
 */

import { RESUME_QUESTION_WAIT_MS } from '#copilot/config/agent';
import { EventEmitter } from 'node:events';
import { waitForAgentSdkEvent } from '../../facades/agent-sdk-runtime.js';

/**
 * @typedef {import('../../types.js').DialogLoopHost} AgentHost
 *
 * @typedef {'reuse-immediate' | 'reuse-preserved' | 'restart-with-model-call'} DialogResumeStrategyKind
 *
 * @typedef {{
 *     kind: DialogResumeStrategyKind;
 *     additionalModelCall: boolean;
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
 * Estratégia A tenta preservar `ask_user` sem nova chamada de modelo; Estratégia B reinicia o boot prompt e inicia uma
 * nova chamada de modelo, sem inferir a unidade de billing do provider.
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
            kind: 'reuse-immediate',
            additionalModelCall: false,
            persistenceLabel: 'dialog.usageMetrics.resume_without_model_call',
            persistenceDescription: 'Persist dialog usage metrics after resume without an additional model call',
            logMessage: '[DialogLoopManager] ask_user já disponível — retomada imediata sem nova chamada de modelo.',
        };
    }

    const pendingTarget = isEventEmitterTarget(host) ? host : fallbackTarget;
    const preserved = await waitForAgentSdkEvent(pendingTarget, 'question.pending', { timeoutMs })
        .then(() => true)
        .catch(() => false);

    if (preserved) {
        return {
            kind: 'reuse-preserved',
            additionalModelCall: false,
            persistenceLabel: 'dialog.usageMetrics.resume_preserved',
            persistenceDescription: 'Persist dialog usage metrics after preserved resume without a new model call',
            logMessage: '[DialogLoopManager] ask_user preservado — retomada sem nova chamada de modelo.',
        };
    }

    return {
        kind: 'restart-with-model-call',
        additionalModelCall: true,
        persistenceLabel: 'dialog.usageMetrics.resume_with_model_call',
        persistenceDescription: 'Persist dialog usage metrics after resume with an additional model call',
        logMessage: '[DialogLoopManager] ask_user não encontrado — reenviando boot prompt com nova chamada de modelo.',
    };
}
