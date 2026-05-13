// @ts-check
/**
 * src/copilot/agent/context/agent-context-dialog-ops.js
 *
 * Operações sobre `dialogState` do AgentContext: pendingQuestion, pendingQuestionShadow, dialogLoopAttached,
 * elicitation SDK. Extraídas de `agent-context.js` na Faixa C3.1.
 *
 * @module copilot/agent/context/agent-context-dialog-ops
 * @internal
 */

import {
    getPendingQuestionShadowAgeMs as shadowAgeMs,
    isPendingQuestionShadowExpired as shadowExpired,
    getPendingQuestionShadowExpiresAt as shadowExpiresAt,
    getPendingQuestionShadowRemainingMs as shadowRemainingMs,
    getPendingQuestionShadowState as shadowState,
} from '../dialog/state/index.js';

/**
 * @typedef {import('../types.js').AgentDialogState} AgentDialogState
 *
 * @typedef {import('../types.js').PendingQuestion} PendingQuestion
 *
 * @typedef {import('../types.js').PendingQuestionShadow} PendingQuestionShadow
 *
 * @typedef {import('../types.js').PendingQuestionKind} PendingQuestionKind
 */

/**
 * Contrato mínimo do contexto para operações de dialog state.
 *
 * @typedef {{
 *     dialogState: AgentDialogState;
 *     sdkElicitation: import('../context-factories.js').AgentContextFactoryHost extends any
 *         ? ReturnType<import('#copilot/sdk').createQueuedElicitationHandler>
 *         : never;
 *     invalidateStatusSnapshot: () => void;
 * }} DialogOpsCtx
 */

/**
 * Contrato mínimo restrito ao `dialogState` + invalidação.
 *
 * @typedef {{
 *     dialogState: AgentDialogState;
 *     invalidateStatusSnapshot: () => void;
 * }} DialogStateCtx
 */

/**
 * Contrato mínimo com sdkElicitation também incluído.
 *
 * @typedef {{
 *     dialogState: AgentDialogState;
 *     sdkElicitation: {
 *         handler: import('#copilot/sdk/types').ElicitationHandler;
 *         listPending: (opts?: { sessionId?: string }) => unknown;
 *         getPending: (id: string) => unknown;
 *         resolvePending: (id: string, result: import('#copilot/sdk/types').ElicitationResult) => boolean;
 *         clearPending: (id: string, opts: { action: 'cancel' }) => boolean;
 *     };
 *     invalidateStatusSnapshot: () => void;
 * }} DialogFullCtx
 */

// ─── Dialog Loop Attached ─────────────────────────────────────────────────────

/**
 * Atualiza a flag de wiring do dialog loop e invalida o snapshot cacheado.
 *
 * @param {DialogStateCtx} ctx
 * @param {boolean} attached
 * @returns {void}
 */
export function setDialogLoopAttached(ctx, attached) {
    ctx.dialogState.dialogLoopAttached = attached;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna o estado de wiring do dialog loop sem expor `dialogState`.
 *
 * @param {DialogStateCtx} ctx
 * @returns {boolean}
 */
export function getDialogLoopAttachedSnapshot(ctx) {
    return ctx.dialogState.dialogLoopAttached;
}

// ─── Pending Question ─────────────────────────────────────────────────────────

/**
 * Atualiza a pergunta pendente do SDK e invalida o snapshot cacheado. Limpa a shadow quando houver nova pergunta.
 *
 * @param {DialogStateCtx} ctx
 * @param {PendingQuestion} question
 * @returns {void}
 */
export function setPendingQuestion(ctx, question) {
    ctx.dialogState.pendingQuestion = question;
    ctx.dialogState.pendingQuestionShadow = null;
    ctx.invalidateStatusSnapshot();
}

/**
 * Limpa a pergunta pendente atual preservando idempotência.
 *
 * @param {DialogStateCtx} ctx
 * @returns {void}
 */
export function clearPendingQuestion(ctx) {
    if (ctx.dialogState.pendingQuestion === null) {
        return;
    }
    ctx.dialogState.pendingQuestion = null;
    ctx.invalidateStatusSnapshot();
}

/**
 * Resolve e limpa a pergunta pendente atual de forma semântica.
 *
 * @param {DialogStateCtx} ctx
 * @param {string} answer
 * @returns {boolean} `true` quando havia pergunta pendente para resolver.
 */
export function resolvePendingQuestion(ctx, answer) {
    const question = ctx.dialogState.pendingQuestion;
    if (question === null) {
        return false;
    }
    const resolved = question.resolve(answer);
    if (resolved === false) {
        return false;
    }
    clearPendingQuestion(ctx);
    return true;
}

/**
 * Indica se há pergunta pendente do SDK aguardando resposta.
 *
 * @param {DialogStateCtx} ctx
 * @returns {boolean}
 */
export function hasPendingQuestion(ctx) {
    return ctx.dialogState.pendingQuestion !== null;
}

/**
 * Retorna a pergunta pendente viva para builders internos que ainda exigem o shape completo.
 *
 * @param {DialogStateCtx} ctx
 * @returns {PendingQuestion | null}
 */
export function getPendingQuestionForStatusSnapshot(ctx) {
    return ctx.dialogState.pendingQuestion;
}

/**
 * Retorna cópia semântica da pergunta pendente atual, quando existir.
 *
 * @param {DialogStateCtx} ctx
 * @returns {{
 *     question: string;
 *     allowFreeform: boolean;
 *     askedAt: number;
 *     kind: PendingQuestionKind;
 *     protocolControlled: boolean;
 *     choices?: string[];
 * } | null}
 */
export function getPendingQuestionSnapshot(ctx) {
    const question = ctx.dialogState.pendingQuestion;
    if (question === null) {
        return null;
    }
    return {
        question: question.question,
        allowFreeform: question.allowFreeform,
        askedAt: question.askedAt,
        kind: question.kind,
        protocolControlled: question.protocolControlled,
        ...(question.choices !== undefined ? { choices: [...question.choices] } : {}),
    };
}

/**
 * Retorna a classificação semântica da pergunta pendente atual.
 *
 * @param {DialogStateCtx} ctx
 * @returns {PendingQuestionKind | null}
 */
export function getPendingQuestionKind(ctx) {
    return ctx.dialogState.pendingQuestion?.kind ?? null;
}

// ─── Pending Question Shadow ──────────────────────────────────────────────────

/**
 * Atualiza a sombra persistida de `ask_user` restaurada do state-io e invalida o snapshot cacheado.
 *
 * @param {DialogStateCtx} ctx
 * @param {PendingQuestionShadow | null} shadow
 * @returns {void}
 */
export function setPendingQuestionShadow(ctx, shadow) {
    ctx.dialogState.pendingQuestionShadow = shadow;
    ctx.invalidateStatusSnapshot();
}

/**
 * Limpa a sombra persistida de `ask_user` preservando idempotência.
 *
 * @param {DialogStateCtx} ctx
 * @returns {void}
 */
export function clearPendingQuestionShadow(ctx) {
    if (ctx.dialogState.pendingQuestionShadow === null) {
        return;
    }
    ctx.dialogState.pendingQuestionShadow = null;
    ctx.invalidateStatusSnapshot();
}

/**
 * Indica se existe sombra persistida de `ask_user` restaurada do state-io.
 *
 * @param {DialogStateCtx} ctx
 * @returns {boolean}
 */
export function hasPendingQuestionShadow(ctx) {
    return ctx.dialogState.pendingQuestionShadow !== null;
}

/**
 * Retorna a classificação semântica da sombra persistida de `ask_user`.
 *
 * @param {DialogStateCtx} ctx
 * @returns {PendingQuestionKind | null}
 */
export function getPendingQuestionShadowKind(ctx) {
    return ctx.dialogState.pendingQuestionShadow?.meta.kind ?? null;
}

/**
 * Retorna cópia defensiva da shadow persistida de `ask_user`, quando houver.
 *
 * @param {DialogStateCtx} ctx
 * @returns {PendingQuestionShadow | null}
 */
export function getPendingQuestionShadowSnapshot(ctx) {
    const shadow = ctx.dialogState.pendingQuestionShadow;
    if (shadow === null) {
        return null;
    }
    return {
        ...shadow,
        meta: {
            ...shadow.meta,
            ...(shadow.meta.choices !== undefined ? { choices: [...shadow.meta.choices] } : {}),
        },
    };
}

/**
 * Retorna a idade da shadow persistida, em ms.
 *
 * @param {DialogStateCtx} ctx
 * @param {number} [now]
 * @returns {number | null}
 */
export function getPendingQuestionShadowAgeMs(ctx, now = Date.now()) {
    return ctx.dialogState.pendingQuestionShadow ? shadowAgeMs(ctx.dialogState.pendingQuestionShadow, now) : null;
}

/**
 * Retorna o timestamp de expiração da shadow persistida.
 *
 * @param {DialogStateCtx} ctx
 * @returns {number | null}
 */
export function getPendingQuestionShadowExpiresAt(ctx) {
    return ctx.dialogState.pendingQuestionShadow ? shadowExpiresAt(ctx.dialogState.pendingQuestionShadow) : null;
}

/**
 * Retorna o tempo restante da shadow persistida até expirar.
 *
 * @param {DialogStateCtx} ctx
 * @param {number} [now]
 * @returns {number | null}
 */
export function getPendingQuestionShadowRemainingMs(ctx, now = Date.now()) {
    return ctx.dialogState.pendingQuestionShadow ? shadowRemainingMs(ctx.dialogState.pendingQuestionShadow, now) : null;
}

/**
 * Retorna o estado semântico da shadow persistida.
 *
 * @param {DialogStateCtx} ctx
 * @param {number} [now]
 * @returns {import('../dialog/state/index.js').PendingQuestionShadowState | null}
 */
export function getPendingQuestionShadowState(ctx, now = Date.now()) {
    return ctx.dialogState.pendingQuestionShadow ? shadowState(ctx.dialogState.pendingQuestionShadow, { now }) : null;
}

/**
 * Indica se a shadow persistida já expirou.
 *
 * @param {DialogStateCtx} ctx
 * @param {number} [now]
 * @returns {boolean}
 */
export function isPendingQuestionShadowExpired(ctx, now = Date.now()) {
    return ctx.dialogState.pendingQuestionShadow
        ? shadowExpired(ctx.dialogState.pendingQuestionShadow, { now })
        : false;
}

// ─── SDK Elicitation ──────────────────────────────────────────────────────────

/**
 * Retorna o handler SDK de elicitation atualmente governado pelo contexto.
 *
 * @param {DialogFullCtx} ctx
 * @returns {import('#copilot/sdk/types').ElicitationHandler}
 */
export function getSdkElicitationHandlerSnapshot(ctx) {
    return ctx.sdkElicitation.handler;
}

/**
 * Lista solicitações de elicitation pendentes.
 *
 * @param {DialogFullCtx} ctx
 * @param {{ sessionId?: string }} [opts]
 * @returns {ReturnType<DialogFullCtx['sdkElicitation']['listPending']>}
 */
export function listPendingSdkElicitations(ctx, opts = {}) {
    return ctx.sdkElicitation.listPending(opts);
}

/**
 * Retorna uma solicitação de elicitation pendente por id.
 *
 * @param {DialogFullCtx} ctx
 * @param {string} id
 * @returns {ReturnType<DialogFullCtx['sdkElicitation']['getPending']>}
 */
export function getPendingSdkElicitation(ctx, id) {
    return ctx.sdkElicitation.getPending(id);
}

/**
 * Resolve uma solicitação de elicitation pendente e invalida o snapshot cacheado se resolvido.
 *
 * @param {DialogFullCtx} ctx
 * @param {string} id
 * @param {import('#copilot/sdk/types').ElicitationResult} result
 * @returns {boolean}
 */
export function resolvePendingSdkElicitation(ctx, id, result) {
    const resolved = ctx.sdkElicitation.resolvePending(id, result);
    if (resolved) ctx.invalidateStatusSnapshot();
    return resolved;
}

/**
 * Cancela ou limpa uma solicitação de elicitation pendente e invalida o snapshot cacheado se limpado.
 *
 * @param {DialogFullCtx} ctx
 * @param {string} id
 * @returns {boolean}
 */
export function clearPendingSdkElicitation(ctx, id) {
    const cleared = ctx.sdkElicitation.clearPending(id, { action: 'cancel' });
    if (cleared) ctx.invalidateStatusSnapshot();
    return cleared;
}
