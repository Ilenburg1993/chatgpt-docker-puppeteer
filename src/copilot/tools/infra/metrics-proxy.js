// @ts-check
/**
 * src/copilot/tools/infra/metrics-proxy.js
 *
 * Proxy de métricas para o módulo tools/.
 *
 * Faixa 3.1 — AC: `tools/ → observability/` layer violation fix.
 *
 * Em vez de importar diretamente de observability/ (camada proibida para tools/), este módulo expõe funções de métricas
 * com implementações injetáveis via `setToolsMetrics()`. Se não injetado, retorna valores no-op / vazios.
 *
 * @module copilot/tools/infra/metrics-proxy
 */

/** @typedef {import('../../observability/metrics-histogram.js').MetricsSummary} MetricsSummary */

/**
 * @typedef {object} ToolStatsEntry
 * @property {number} calls
 * @property {number} errors
 * @property {number} avgLatencyMs
 * @property {number} errorRate
 * @property {string | null} lastCallIso
 * @property {boolean} lastOk
 */

/**
 * @typedef {object} MetricsProxyImpl
 * @property {() => MetricsSummary} getSummary
 * @property {() => Record<string, ToolStatsEntry>} getToolStats
 * @property {(name: string, durationMs: number, success?: boolean) => void} recordToolCall
 */

/** @type {MetricsProxyImpl | null} */
let _impl = null;

/**
 * Injeta a implementação real de métricas (chamado por agent/ ou server/ ao inicializar).
 *
 * @param {MetricsProxyImpl} impl
 * @returns {void}
 */
export function setToolsMetrics(impl) {
    _impl = impl;
}

/**
 * Remove a implementação injetada (ex: após shutdown ou em testes).
 *
 * @returns {void}
 */
export function clearToolsMetrics() {
    _impl = null;
}

/**
 * Retorna summary de métricas da sessão. Retorna objeto vazio se não injetado.
 *
 * M3-FIXED: Validação de fallback — se métricas não injetadas, retorna {} em vez de falhar.
 *
 * @returns {MetricsSummary}
 */
export function getSummary() {
    return _impl?.getSummary() ?? /** @type {MetricsSummary} */ ({});
}

/**
 * Retorna stats por tool. Retorna objeto vazio se não injetado.
 *
 * M3-FIXED: Fallback seguro se _impl for null.
 *
 * @returns {Record<string, ToolStatsEntry>}
 */
export function getToolStats() {
    return _impl?.getToolStats() ?? {};
}

/**
 * Registra chamada de tool. No-op se não injetado.
 *
 * M3-FIXED: Se não injetado, a chamada é ignorada silenciosamente (não falha).
 *
 * @param {string} name
 * @param {number} durationMs
 * @param {boolean} [success]
 * @returns {void}
 */
export function recordToolCall(name, durationMs, success = true) {
    _impl?.recordToolCall(name, durationMs, success);
}
