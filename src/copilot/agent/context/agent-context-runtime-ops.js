// @ts-check
/**
 * src/copilot/agent/context/agent-context-runtime-ops.js
 *
 * Operações sobre `runtimeState` do AgentContext: timers, monitors, observers e relatórios de boot/start. Extraídas de
 * `agent-context.js` na Faixa C3.1.
 *
 * @module copilot/agent/context/agent-context-runtime-ops
 * @internal
 */

/**
 * @typedef {import('../types.js').AgentRuntimeState} AgentRuntimeState
 *
 * @typedef {import('../types.js').AgentBootReport} AgentBootReport
 *
 * @typedef {import('../types.js').AgentStartReport} AgentStartReport
 */

/**
 * Contrato mínimo do contexto para operações de runtime state.
 *
 * @typedef {{
 *     runtimeState: AgentRuntimeState;
 *     invalidateStatusSnapshot: () => void;
 * }} RuntimeOpsCtx
 */

// ─── Quota Monitor ────────────────────────────────────────────────────────────

/**
 * Atualiza o quota monitor acoplado ao runtime.
 *
 * @param {RuntimeOpsCtx} ctx
 * @param {import('#copilot/sdk/types').QuotaMonitor} quotaMonitor
 * @returns {void}
 */
export function setQuotaMonitor(ctx, quotaMonitor) {
    ctx.runtimeState.quotaMonitor = quotaMonitor;
}

/**
 * Limpa a referência do quota monitor preservando idempotência.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {void}
 */
export function clearQuotaMonitor(ctx) {
    ctx.runtimeState.quotaMonitor = null;
}

/**
 * Para o quota monitor ativo e limpa sua referência.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {void}
 */
export function stopQuotaMonitor(ctx) {
    const quotaMonitor = ctx.runtimeState.quotaMonitor;
    if (!quotaMonitor) {
        return;
    }
    quotaMonitor.stop();
    clearQuotaMonitor(ctx);
}

/**
 * Retorna o quota monitor ativo sem expor diretamente `runtimeState`.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {import('#copilot/sdk/types').QuotaMonitor | null}
 */
export function getQuotaMonitorSnapshot(ctx) {
    return ctx.runtimeState.quotaMonitor;
}

// ─── Metrics Timer ────────────────────────────────────────────────────────────

/**
 * Atualiza o timer periódico de métricas do runtime.
 *
 * @param {RuntimeOpsCtx} ctx
 * @param {ReturnType<typeof setInterval>} timer
 * @returns {void}
 */
export function setMetricsTimer(ctx, timer) {
    ctx.runtimeState.metricsTimer = timer;
}

/**
 * Limpa a referência do timer periódico de métricas.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {void}
 */
export function clearMetricsTimer(ctx) {
    ctx.runtimeState.metricsTimer = null;
}

/**
 * Retorna o timer periódico de métricas do runtime.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {ReturnType<typeof setInterval> | null}
 */
export function getMetricsTimerSnapshot(ctx) {
    return ctx.runtimeState.metricsTimer;
}

// ─── MCP Reconnect ────────────────────────────────────────────────────────────

/**
 * Atualiza o cancel handler do auto-reconnect MCP.
 *
 * @param {RuntimeOpsCtx} ctx
 * @param {() => void} cancel
 * @returns {void}
 */
export function setMcpReconnectCancel(ctx, cancel) {
    ctx.runtimeState.mcpReconnectCancel = cancel;
}

/**
 * Limpa a referência do cancel handler do auto-reconnect MCP.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {void}
 */
export function clearMcpReconnectCancel(ctx) {
    ctx.runtimeState.mcpReconnectCancel = null;
}

/**
 * Retorna o cancel handler atual do auto-reconnect MCP.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {(() => void) | null}
 */
export function getMcpReconnectCancelSnapshot(ctx) {
    return ctx.runtimeState.mcpReconnectCancel;
}

// ─── Agent Observer ───────────────────────────────────────────────────────────

/**
 * Atualiza o observer do agente usado pelo boot/lifecycle.
 *
 * @param {RuntimeOpsCtx} ctx
 * @param {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void }} observer
 * @returns {void}
 */
export function setAgentObserver(ctx, observer) {
    ctx.runtimeState.agentObserver = observer;
}

/**
 * Limpa a referência do observer do agente.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {void}
 */
export function clearAgentObserver(ctx) {
    ctx.runtimeState.agentObserver = null;
}

/**
 * Retorna o observer atual do agente, quando houver.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null}
 */
export function getAgentObserverSnapshot(ctx) {
    return ctx.runtimeState.agentObserver;
}

// ─── Boot / Start Reports ─────────────────────────────────────────────────────

/**
 * Registra o último relatório de boot conhecido.
 *
 * @param {RuntimeOpsCtx} ctx
 * @param {AgentBootReport | null} report
 * @returns {void}
 */
export function setBootReport(ctx, report) {
    ctx.runtimeState.lastBootReport = report;
}

/**
 * Registra o último relatório transacional de start conhecido e invalida o snapshot cacheado.
 *
 * @param {RuntimeOpsCtx} ctx
 * @param {AgentStartReport | null} report
 * @returns {void}
 */
export function setStartReport(ctx, report) {
    ctx.runtimeState.lastStartReport = report;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna cópia defensiva do último boot report conhecido.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {AgentBootReport | null}
 */
export function getBootReportSnapshot(ctx) {
    const report = ctx.runtimeState.lastBootReport;
    if (report === null) {
        return null;
    }
    return {
        ...report,
        steps: report.steps.map((step) => ({ ...step })),
    };
}

/**
 * Retorna cópia defensiva do último start report conhecido.
 *
 * @param {RuntimeOpsCtx} ctx
 * @returns {AgentStartReport | null}
 */
export function getStartReportSnapshot(ctx) {
    const report = ctx.runtimeState.lastStartReport;
    if (report === null) {
        return null;
    }
    return {
        ...report,
        phases: report.phases.map((phase) => ({ ...phase })),
    };
}
