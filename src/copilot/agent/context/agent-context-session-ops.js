// @ts-check
/**
 * src/copilot/agent/context/agent-context-session-ops.js
 *
 * Operações sobre `sessionState` e `ioState` do AgentContext: client SDK, sessão, reconexão, contexto de tokens.
 * Extraídas de `agent-context.js` na Faixa C3.1.
 *
 * @module copilot/agent/context/agent-context-session-ops
 * @internal
 */

/**
 * @typedef {import('../types.js').AgentSessionState} AgentSessionState
 *
 * @typedef {import('../types.js').AgentIOState} AgentIOState
 *
 * @typedef {import('#copilot/sdk/types').CopilotClient} CopilotClient
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 */

/**
 * Contrato mínimo do contexto para operações de sessão/IO.
 *
 * @typedef {{
 *     sessionState: AgentSessionState;
 *     ioState: AgentIOState;
 *     invalidateStatusSnapshot: () => void;
 * }} SessionOpsCtx
 */

// ─── IO State ──────────────────────────────────────────────────────────────────

/**
 * Atualiza o cliente SDK ativo e invalida o snapshot cacheado.
 *
 * @param {SessionOpsCtx} ctx
 * @param {CopilotClient} client
 * @returns {void}
 */
export function setClient(ctx, client) {
    ctx.ioState.client = client;
    ctx.invalidateStatusSnapshot();
}

/**
 * Remove o cliente SDK ativo preservando idempotência.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {void}
 */
export function clearClient(ctx) {
    if (ctx.ioState.client === null) {
        return;
    }
    ctx.ioState.client = null;
    ctx.invalidateStatusSnapshot();
}

/**
 * Indica se existe client SDK ativo acoplado ao agent.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {boolean}
 */
export function hasClient(ctx) {
    return ctx.ioState.client !== null;
}

/**
 * Retorna o client SDK ativo sem expor diretamente o shape cru de `ioState`.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {CopilotClient | null}
 */
export function getClientSnapshot(ctx) {
    return ctx.ioState.client;
}

// ─── Session State ─────────────────────────────────────────────────────────────

/**
 * Atualiza a sessão SDK ativa e invalida o snapshot cacheado.
 *
 * @param {SessionOpsCtx} ctx
 * @param {CopilotSession} session
 * @returns {void}
 */
export function setSession(ctx, session) {
    ctx.sessionState.session = session;
    ctx.invalidateStatusSnapshot();
}

/**
 * Remove a sessão SDK ativa preservando idempotência.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {void}
 */
export function clearSession(ctx) {
    if (ctx.sessionState.session === null) {
        return;
    }
    ctx.sessionState.session = null;
    ctx.invalidateStatusSnapshot();
}

/**
 * Indica se existe sessão SDK ativa acoplada ao agent.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {boolean}
 */
export function hasActiveSession(ctx) {
    return ctx.sessionState.session !== null;
}

/**
 * Retorna a sessão SDK ativa sem expor diretamente o shape cru de `sessionState`.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {CopilotSession | null}
 */
export function getSessionSnapshot(ctx) {
    return ctx.sessionState.session;
}

// ─── Session Metadata ─────────────────────────────────────────────────────────

/**
 * Atualiza a flag de sessão retomada e invalida o snapshot cacheado.
 *
 * @param {SessionOpsCtx} ctx
 * @param {boolean} isResumed
 * @returns {void}
 */
export function setIsResumed(ctx, isResumed) {
    ctx.sessionState.isResumed = isResumed;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna se a sessão atual foi retomada.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {boolean}
 */
export function getIsResumedSnapshot(ctx) {
    return ctx.sessionState.isResumed;
}

/**
 * Atualiza a flag de reconexão em andamento e invalida o snapshot cacheado.
 *
 * @param {SessionOpsCtx} ctx
 * @param {boolean} isReconnecting
 * @returns {void}
 */
export function setReconnectState(ctx, isReconnecting) {
    ctx.sessionState.isReconnecting = isReconnecting;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna o estado de reconexão ativo.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {boolean}
 */
export function isReconnectActive(ctx) {
    return ctx.sessionState.isReconnecting;
}

/**
 * Substitui a lista de unsubscribers da sessão por uma cópia defensiva.
 *
 * @param {SessionOpsCtx} ctx
 * @param {(() => void)[]} unsubs
 * @returns {void}
 */
export function setSessionEventUnsubscribers(ctx, unsubs) {
    ctx.sessionState.sessionEventUnsubscribers = [...unsubs];
}

/**
 * Limpa a lista de unsubscribers da sessão atual preservando idempotência.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {void}
 */
export function clearSessionEventUnsubscribers(ctx) {
    if (ctx.sessionState.sessionEventUnsubscribers.length === 0) {
        return;
    }
    ctx.sessionState.sessionEventUnsubscribers = [];
}

/**
 * Retorna cópia defensiva dos unsubscribers registrados para a sessão ativa.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {(() => void)[]}
 */
export function getSessionEventUnsubscribersSnapshot(ctx) {
    return [...ctx.sessionState.sessionEventUnsubscribers];
}

/**
 * Atualiza o estado de uso da janela de contexto e invalida o snapshot cacheado.
 *
 * @param {SessionOpsCtx} ctx
 * @param {{ tokens: number; tokenLimit: number; utilization: number } | null} state
 * @returns {void}
 */
export function setContextState(ctx, state) {
    ctx.sessionState.contextState = state;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna cópia rasa do último uso de contexto conhecido.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {{ tokens: number; tokenLimit: number; utilization: number } | null}
 */
export function getContextStateSnapshot(ctx) {
    return ctx.sessionState.contextState ? { ...ctx.sessionState.contextState } : null;
}

/**
 * Atualiza o último checkpoint persistido pelo SDK e invalida o snapshot cacheado.
 *
 * @param {SessionOpsCtx} ctx
 * @param {string | null} path
 * @returns {void}
 */
export function setLastCheckpointPath(ctx, path) {
    ctx.sessionState.lastCheckpointPath = path;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna o último checkpoint path persistido pelo SDK.
 *
 * @param {SessionOpsCtx} ctx
 * @returns {string | null}
 */
export function getLastCheckpointPathSnapshot(ctx) {
    return ctx.sessionState.lastCheckpointPath;
}
