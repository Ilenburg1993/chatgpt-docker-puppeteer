// @ts-check
/**
 * @module copilot/agent/facades/agent-runtime-state
 * @file Façade semântica para fallback de estado persistido do runtime vivo.
 */

import { logSwallowed } from '#copilot/core';
import { createPendingQuestionShadow, isPendingQuestionShadowExpired } from '../dialog/pending-question-shadow.js';
import { persistStateWithPolicy, readState, readStateAsync } from '../lifecycle/state-io.js';
import { createSnapshot, saveSnapshotAsync } from '../session/snapshot.js';

/**
 * @typedef {{
 *     question: string;
 *     allowFreeform: boolean;
 *     askedAt: number;
 *     kind: import('../types.js').PendingQuestionKind;
 *     protocolControlled: boolean;
 *     choices?: string[];
 * }} AgentRuntimePendingQuestionSnapshot
 *
 *
 * @typedef {{
 *     getSessionSnapshot?: (() => import('#copilot/sdk/types').CopilotSession | null) | undefined;
 *     hasPendingQuestion?: (() => boolean) | undefined;
 *     hasPendingQuestionShadow: () => boolean;
 *     isPendingQuestionShadowExpired?: (() => boolean) | undefined;
 *     clearPendingQuestionShadow: () => void;
 *     setPendingQuestionShadow?: ((shadow: import('../types.js').PendingQuestionShadow) => void) | undefined;
 *     setSendCount?: ((count: number) => void) | undefined;
 *     getPendingQuestionSnapshot?: (() => AgentRuntimePendingQuestionSnapshot | null) | undefined;
 *     getModelSnapshot?: (() => string) | undefined;
 *     getRuntimeStatus?: (() => string) | undefined;
 *     getSendCountSnapshot?: (() => number) | undefined;
 *     isDialogLoopPaused?: (() => boolean) | undefined;
 *     trackBackgroundTask?:
 *         | ((task: Promise<unknown>, meta?: { label?: string; description?: string }) => Promise<void>)
 *         | undefined;
 * }} AgentRuntimeStateContext
 *
 *
 * @typedef {{
 *     sendCount: number;
 *     pendingQuestionShadowRestored: boolean;
 *     pendingQuestionShadowExpired: boolean;
 * }} AgentRuntimePersistentBootStateResult
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
 * Lê o sessionId atual do runtime usando a sessão viva e, como fallback controlado, o snapshot persistido.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {string | null}
 */
export function readAgentRuntimeSessionId(ctx) {
    const activeSessionId = ctx.getSessionSnapshot?.()?.sessionId ?? null;
    if (typeof activeSessionId === 'string' && activeSessionId.length > 0) {
        return activeSessionId;
    }

    const persistedSessionId = readState()?.sessionId ?? null;
    return typeof persistedSessionId === 'string' && persistedSessionId.length > 0 ? persistedSessionId : null;
}

/**
 * Lê o bootstrap persistido do dialog loop para inicialização síncrona do runtime.
 *
 * @returns {{ dialogPaused: boolean; prMetrics: Record<string, unknown> | null }}
 */
export function readAgentRuntimeDialogBootstrapState() {
    const persistedState = readState();
    const rawPrMetrics = persistedState?.prMetrics;
    return {
        dialogPaused: Boolean(persistedState?.dialogPaused),
        prMetrics: rawPrMetrics && typeof rawPrMetrics === 'object' ? rawPrMetrics : null,
    };
}

/**
 * Lê de forma assíncrona o estado persistido mínimo do dialog loop.
 *
 * @returns {Promise<{ dialogPaused: boolean; dialogLoopActive: boolean }>}
 */
export async function readAgentRuntimeDialogPersistedState() {
    const state = await readStateAsync();
    return {
        dialogPaused: Boolean(state?.dialogPaused),
        dialogLoopActive: Boolean(state?.dialogLoopActive),
    };
}

/**
 * Persiste fragmento parcial do estado do dialog loop usando policy canônica do agent.
 *
 * @param {Record<string, unknown>} partial
 * @param {string} label
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimeDialogState(partial, label) {
    return persistStateWithPolicy(partial, { label });
}

/**
 * Persiste o marcador canônico de turno pendente do dialog loop.
 *
 * @param {{ message: string; ts: number }} input
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePendingTurnState(input) {
    return persistStateWithPolicy(
        {
            pendingTurnMessage: input.message,
            pendingTurnTs: input.ts,
            pendingTurnConsumedPR: false,
        },
        { label: 'dialog.turn.pending' },
    );
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
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
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

/**
 * Decide se o boot do runtime deve agendar tentativa de recovery do dialog loop a partir do estado persistido.
 *
 * Regra atual: só agenda recovery quando o snapshot indica que o dialog loop estava ativo e não estava pausado.
 *
 * @returns {Promise<boolean>}
 */
export async function shouldScheduleAgentRuntimeDialogBootRecovery() {
    const savedState = await readStateAsync();
    return Boolean(savedState?.dialogLoopActive && !savedState?.dialogPaused);
}

/**
 * Persiste a intenção canônica de `dialogPaused=true` antes do boot recovery do dialog loop.
 *
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function markAgentRuntimeDialogPausedForRecovery() {
    return persistStateWithPolicy({ dialogPaused: true }, { label: 'dialog.boot_recovery.pause' });
}

/**
 * Reseta a flag persistida de shutdown gracioso no começo do boot do runtime.
 *
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function resetAgentRuntimeGracefulShutdownFlag() {
    return persistStateWithPolicy({ gracefulShutdown: false }, { label: 'state.gracefulShutdown.reset' });
}

/**
 * Persiste o último snapshot de consumo PR do runtime.
 *
 * @param {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number }} info
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimePrConsumptionSnapshot(info) {
    return persistStateWithPolicy(
        {
            pendingTurnConsumedPR: true,
            lastPrConsumedAt: info.ts,
            lastPrModel: info.model ?? '',
            lastPrCost: info.cost ?? 0,
            lastQuotaSnapshots: info.quotaSnapshots ?? null,
        },
        { label: 'state.pr_consumed.persist' },
    );
}

/**
 * Restaura do state persistido o contador de envios e a shadow de pergunta pendente.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @returns {Promise<AgentRuntimePersistentBootStateResult>}
 */
export async function restoreAgentRuntimePersistentBootState(ctx) {
    const persistedState = await readStateAsync();
    const sendCount = persistedState?.sendCount ?? 0;
    ctx.setSendCount?.(sendCount);

    if (!persistedState?.pendingQuestion || !persistedState.pendingQuestionMeta) {
        ctx.clearPendingQuestionShadow();
        return {
            sendCount,
            pendingQuestionShadowRestored: false,
            pendingQuestionShadowExpired: false,
        };
    }

    const pendingQuestionShadow = createPendingQuestionShadow(
        persistedState.pendingQuestion,
        persistedState.pendingQuestionMeta,
    );
    ctx.setPendingQuestionShadow?.(pendingQuestionShadow);

    const expired = isPendingQuestionShadowExpired(pendingQuestionShadow);
    if (expired) {
        const persistTask = persistStateWithPolicy(
            { pendingQuestion: null, pendingQuestionMeta: null },
            { label: 'state.pendingQuestionShadow.expire' },
        ).then(() => undefined);
        if (typeof ctx.trackBackgroundTask === 'function') {
            void ctx.trackBackgroundTask(persistTask, {
                label: 'state.pendingQuestionShadow.expire',
                description: 'Clear expired ask_user shadow from persisted state',
            });
        } else {
            void persistTask.catch((error) => logSwallowed(error, 'agent.runtimeState.pendingQuestionShadow.expire'));
        }
    }

    return {
        sendCount,
        pendingQuestionShadowRestored: true,
        pendingQuestionShadowExpired: expired,
    };
}

/**
 * Salva snapshot operacional do runtime antes do shutdown.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{
 *     sessionId?: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPrMetrics?: { boots: number; resumesWithPR: number; resumesZeroPR: number; totalPR: number } | null;
 *     reason?: string;
 * }} options
 * @returns {Promise<string>}
 */
export async function saveAgentRuntimeShutdownSnapshot(ctx, options) {
    const pendingQuestion = ctx.getPendingQuestionSnapshot?.() ?? null;
    const snap = createSnapshot({
        sessionId: options.sessionId ?? null,
        model: ctx.getModelSnapshot?.() ?? 'unknown',
        status: ctx.getRuntimeStatus?.() ?? 'unknown',
        sendCount: ctx.getSendCountSnapshot?.() ?? 0,
        dialogLoopActive: options.dialogLoopActive,
        dialogPaused: ctx.isDialogLoopPaused?.() ?? false,
        pendingQuestion: pendingQuestion?.question ?? null,
        pendingQuestionMeta:
            pendingQuestion !== null
                ? {
                      kind: pendingQuestion.kind,
                      askedAt: pendingQuestion.askedAt,
                      allowFreeform: pendingQuestion.allowFreeform,
                      protocolControlled: pendingQuestion.protocolControlled,
                      ...(pendingQuestion.choices !== undefined ? { choices: pendingQuestion.choices } : {}),
                  }
                : null,
        prMetrics: options.dialogPrMetrics ?? null,
        reason: options.reason ?? 'auto-shutdown',
    });
    return saveSnapshotAsync(snap);
}

/**
 * Persiste o state mínimo de shutdown gracioso para o próximo boot.
 *
 * @param {AgentRuntimeStateContext} ctx
 * @param {{ dialogLoopActive: boolean }} options
 * @returns {Promise<
 *     import('../error-policy.js').AgentPolicyResult<import('../lifecycle/state-io.js').AliveAgentState>
 * >}
 */
export async function persistAgentRuntimeGracefulShutdownState(ctx, options) {
    return persistStateWithPolicy(
        {
            sendCount: ctx.getSendCountSnapshot?.() ?? 0,
            gracefulShutdown: true,
            dialogLoopActive: options.dialogLoopActive,
            dialogPaused: ctx.isDialogLoopPaused?.() ?? false,
        },
        { label: 'state.gracefulShutdown.persist' },
    );
}
