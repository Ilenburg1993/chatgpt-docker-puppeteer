// @ts-check
/**
 * @module copilot/agent/runtime/pending-question-state
 * @file Seams de governança da pending question/shadow do runtime.
 */

import { logSwallowed } from '#copilot/core';
import { persistStateWithPolicy } from '../lifecycle/state/state-io.js';

/**
 * @typedef {import('../facades/agent-runtime-state.js').AgentRuntimeStateContext} AgentRuntimeStateContext
 */

/**
 * Decide se a shadow persistida de `ask_user` deve ser removida no reap contínuo.
 *
 * Regra: só remove quando não existe pergunta viva, existe shadow e ela já expirou.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {boolean}
 */
export function shouldReapAgentRuntimePendingQuestionShadow(ctx) {
    const hasLivePending = ctx.hasPendingQuestion?.() ?? false;
    const hasShadow = ctx.hasPendingQuestionShadow();
    const shadowExpired = ctx.isPendingQuestionShadowExpired?.() ?? false;
    return !hasLivePending && hasShadow && shadowExpired;
}

/**
 * Persiste a pergunta pendente canônica produzida por `ask_user`.
 *
 * @param {{
 *     question: string;
 *     meta: import('../types.js').PendingQuestionMeta;
 *     askedAt: number;
 * }} input
 * @param {{ label?: string }} [options]
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePendingQuestionState(input, options = {}) {
    return persistStateWithPolicy(
        {
            pendingQuestion: input.question,
            pendingQuestionMeta: input.meta,
            lastAskUserAt: input.askedAt,
        },
        { label: options.label ?? 'question.persist.pending' },
    );
}

/**
 * Limpa a shadow persistida de `ask_user` restaurada no runtime e agenda a persistência canônica.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{ label?: string; description?: string }} [options]
 * @returns {boolean}
 */
export function clearAgentRuntimePendingQuestionShadow(ctx, options = {}) {
    if (!ctx.hasPendingQuestionShadow()) {
        return false;
    }

    const label = options.label ?? 'state.pendingQuestionShadow.clear';
    const description = options.description ?? 'Clear ask_user shadow from persisted state';

    ctx.clearPendingQuestionShadow();

    const persistTask = persistStateWithPolicy({ pendingQuestion: null, pendingQuestionMeta: null }, { label }).then(
        (result) => {
            if (!result.ok) {
                throw result.error;
            }
            return undefined;
        },
    );

    if (typeof ctx.trackBackgroundTask === 'function') {
        void ctx.trackBackgroundTask(persistTask, { label, description });
    } else {
        void persistTask.catch((error) => logSwallowed(error, `agent.runtimeState.${label}`));
    }

    return true;
}
