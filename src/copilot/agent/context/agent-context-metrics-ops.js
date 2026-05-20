// @ts-check
/**
 * src/copilot/agent/context/agent-context-metrics-ops.js
 *
 * Operações sobre `metricsState` do AgentContext: contadores de envio, cache de snapshot, PR info e telemetria LLM.
 * Extraídas de `agent-context.js` na Faixa C3.1.
 *
 * @module copilot/agent/context/agent-context-metrics-ops
 * @internal
 */

/**
 * @typedef {import('../types.js').AgentMetricsState} AgentMetricsState
 *
 * @typedef {import('../types.js').AgentStatusSnapshot} AgentStatusSnapshot
 */

/**
 * Contrato mínimo do contexto para operações de métricas.
 *
 * @typedef {{
 *     metricsState: AgentMetricsState;
 *     invalidateStatusSnapshot: () => void;
 * }} MetricsOpsCtx
 */

/**
 * Invalida o cache do snapshot público de status.
 *
 * @param {MetricsOpsCtx} ctx
 * @returns {void}
 */
export function invalidateStatusSnapshot(ctx) {
    ctx.metricsState.statusSnapshotCache = null;
}

/**
 * Atualiza o cache de snapshot com o valor já construído.
 *
 * @param {MetricsOpsCtx} ctx
 * @param {AgentStatusSnapshot} snapshot
 * @returns {void}
 */
export function cacheStatusSnapshot(ctx, snapshot) {
    ctx.metricsState.statusSnapshotCache = { snapshot, at: Date.now() };
}

/**
 * Retorna o cache de status ainda válido para o TTL informado; invalida e retorna null se expirado.
 *
 * @param {MetricsOpsCtx} ctx
 * @param {number} ttlMs
 * @returns {AgentStatusSnapshot | null}
 */
export function getFreshStatusSnapshotCache(ctx, ttlMs) {
    const cached = ctx.metricsState.statusSnapshotCache;
    if (!cached) {
        return null;
    }
    if (Date.now() - cached.at < ttlMs) {
        return cached.snapshot;
    }
    invalidateStatusSnapshot(ctx);
    return null;
}

/**
 * Define o contador absoluto de envios.
 *
 * @param {MetricsOpsCtx} ctx
 * @param {number} sendCount
 * @returns {void}
 */
export function setSendCount(ctx, sendCount) {
    ctx.metricsState.sendCount = sendCount;
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna o contador atual de envios.
 *
 * @param {MetricsOpsCtx} ctx
 * @returns {number}
 */
export function getSendCountSnapshot(ctx) {
    return ctx.metricsState.sendCount;
}

/**
 * Incrementa o contador de envios e invalida o snapshot cacheado. Retorna o novo valor.
 *
 * @param {MetricsOpsCtx} ctx
 * @returns {number}
 */
export function incrementSendCount(ctx) {
    ctx.metricsState.sendCount += 1;
    ctx.invalidateStatusSnapshot();
    return ctx.metricsState.sendCount;
}

/**
 * Atualiza o último snapshot de consumo de PR/quota. Cria cópia defensiva quando não nulo.
 *
 * @param {MetricsOpsCtx} ctx
 * @param {{
 *     model?: string;
 *     configuredModel?: string;
 *     effectiveModel?: string;
 *     modelMismatch?: boolean;
 *     sessionId?: string | null;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * } | null} info
 * @returns {void}
 */
export function setLastPrInfo(ctx, info) {
    ctx.metricsState.lastPrInfo = info ? { ...info } : null;
}

/**
 * Retorna cópia rasa do último snapshot de PR/quota conhecido.
 *
 * @param {MetricsOpsCtx} ctx
 * @returns {{
 *     model?: string;
 *     configuredModel?: string;
 *     effectiveModel?: string;
 *     modelMismatch?: boolean;
 *     sessionId?: string | null;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * } | null}
 */
export function getLastPrInfoSnapshot(ctx) {
    return ctx.metricsState.lastPrInfo ? { ...ctx.metricsState.lastPrInfo } : null;
}

/**
 * Atualiza a última telemetria LLM classificada. Não atualiza `lastPrInfo`.
 *
 * @param {MetricsOpsCtx} ctx
 * @param {Record<string, unknown> | null} info
 * @returns {void}
 */
export function setLastLlmUsage(ctx, info) {
    ctx.metricsState.lastLlmUsage = info ? { ...info } : null;
}

/**
 * Retorna cópia rasa da última telemetria LLM classificada.
 *
 * @param {MetricsOpsCtx} ctx
 * @returns {Record<string, unknown> | null}
 */
export function getLastLlmUsageSnapshot(ctx) {
    return ctx.metricsState.lastLlmUsage ? { ...ctx.metricsState.lastLlmUsage } : null;
}
