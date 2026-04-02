// @ts-check
/**
 * src/copilot/observability/metrics.js
 *
 * Métricas agregadas para src/copilot com suporte a percentis (p50/p95/p99).
 *
 * Rastreia:
 *
 * - Tool call latências (histograma rolling)
 * - Contagem de erros/sucessos por tool
 * - Token usage agregado (input/output/cache)
 * - Sessões iniciadas/encerradas
 * - Taxa de erros global
 *
 * @module copilot/observability/metrics
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} LatencyHistogram
 * @property {number} count - Total de amostras.
 * @property {number} sum - Soma das latências (ms).
 * @property {number} min - Menor latência registrada.
 * @property {number} max - Maior latência registrada.
 * @property {number} p50 - Percentil 50.
 * @property {number} p95 - Percentil 95.
 * @property {number} p99 - Percentil 99.
 */

/**
 * @typedef {object} ToolMetrics
 * @property {number} totalCalls - Total de chamadas.
 * @property {number} successCount - Chamadas com sucesso.
 * @property {number} errorCount - Chamadas com erro.
 * @property {LatencyHistogram} latency - Histograma de latências.
 */

/**
 * @typedef {object} TokenUsageMetrics
 * @property {number} inputTokens - Total de tokens de input.
 * @property {number} outputTokens - Total de tokens de output.
 * @property {number} cacheReadTokens - Tokens lidos de cache.
 * @property {number} cacheWriteTokens - Tokens escritos em cache.
 * @property {Record<string, number>} byModel - Tokens de output por modelo.
 */

/**
 * @typedef {object} SessionMetrics
 * @property {number} started - Sessões iniciadas.
 * @property {number} ended - Sessões encerradas.
 * @property {number} errors - Erros de sessão (session.error).
 */

/**
 * @typedef {object} MetricsSummary
 * @property {Record<string, ToolMetrics>} tools - Métricas por ferramenta.
 * @property {TokenUsageMetrics} tokens - Uso de tokens acumulado.
 * @property {SessionMetrics} sessions - Contadores de sessão.
 * @property {number} collectedAt - Timestamp da coleta.
 */

/**
 * @typedef {object} MetricsStore
 * @property {(toolName: string, durationMs: number, success: boolean) => void} recordToolCall
 * @property {(model: string, input?: number, output?: number, cacheRead?: number, cacheWrite?: number) => void} recordUsage
 * @property {() => void} recordSessionStart
 * @property {() => void} recordSessionEnd
 * @property {() => void} recordSessionError
 * @property {() => MetricsSummary} getSummary
 * @property {() => void} reset
 */

// ─── Helpers para percentis ───────────────────────────────────────────────────

/**
 * Calcula percentil de um array ordenado.
 *
 * @param {number[]} sorted - Array ordenado crescente.
 * @param {number} p - Percentil de 0 a 100.
 * @returns {number}
 */
function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1);
    return sorted[idx] ?? 0;
}

/**
 * Cria um histograma de latências com ring buffer internamente.
 *
 * @param {number} maxSamples
 * @returns {{ record(ms: number): void; snapshot(): LatencyHistogram }}
 */
function createHistogram(maxSamples = 500) {
    /** @type {number[]} */
    const _samples = [];
    let _sorted = false;
    let _min = Infinity;
    let _max = -Infinity;
    let _sum = 0;

    return {
        record(ms) {
            if (_samples.length >= maxSamples) _samples.shift();
            _samples.push(ms);
            _sorted = false;
            if (ms < _min) _min = ms;
            if (ms > _max) _max = ms;
            _sum += ms;
        },
        snapshot() {
            if (!_samples.length) {
                return { count: 0, sum: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
            }
            if (!_sorted) {
                _samples.sort((a, b) => a - b);
                _sorted = true;
            }
            return {
                count: _samples.length,
                sum: _sum,
                min: _min,
                max: _max,
                p50: percentile(_samples, 50),
                p95: percentile(_samples, 95),
                p99: percentile(_samples, 99),
            };
        },
    };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria um MetricsStore.
 *
 * @returns {MetricsStore}
 */
export function createMetricsStore() {
    /** @type {Record<
    string,
    { total: number; success: number; errors: number; histogram: ReturnType<typeof createHistogram> }
>} */
    const _tools = {};

    /** @type {TokenUsageMetrics} */
    const _tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, byModel: {} };

    /** @type {SessionMetrics} */
    const _sessions = { started: 0, ended: 0, errors: 0 };

    /**
     * @param {string} toolName
     * @param {number} durationMs
     * @param {boolean} success
     */
    function recordToolCall(toolName, durationMs, success) {
        if (!_tools[toolName]) {
            _tools[toolName] = { total: 0, success: 0, errors: 0, histogram: createHistogram(500) };
        }
        const t = _tools[toolName];
        t.total++;
        if (success) t.success++;
        else t.errors++;
        t.histogram.record(durationMs);
    }

    /**
     * @param {string} model
     * @param {number} [input=0] Default is `0`
     * @param {number} [output=0] Default is `0`
     * @param {number} [cacheRead=0] Default is `0`
     * @param {number} [cacheWrite=0] Default is `0`
     */
    function recordUsage(model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0) {
        _tokens.inputTokens += input;
        _tokens.outputTokens += output;
        _tokens.cacheReadTokens += cacheRead;
        _tokens.cacheWriteTokens += cacheWrite;
        _tokens.byModel[model] = (_tokens.byModel[model] ?? 0) + output;
    }

    function recordSessionStart() {
        _sessions.started++;
    }
    function recordSessionEnd() {
        _sessions.ended++;
    }
    function recordSessionError() {
        _sessions.errors++;
    }

    /**
     * @returns {MetricsSummary}
     */
    function getSummary() {
        /** @type {Record<string, ToolMetrics>} */
        const tools = {};
        for (const [name, t] of Object.entries(_tools)) {
            tools[name] = {
                totalCalls: t.total,
                successCount: t.success,
                errorCount: t.errors,
                latency: t.histogram.snapshot(),
            };
        }
        return {
            tools,
            tokens: { ..._tokens, byModel: { ..._tokens.byModel } },
            sessions: { ..._sessions },
            collectedAt: Date.now(),
        };
    }

    function reset() {
        Object.keys(_tools).forEach((k) => delete _tools[k]);
        _tokens.inputTokens = 0;
        _tokens.outputTokens = 0;
        _tokens.cacheReadTokens = 0;
        _tokens.cacheWriteTokens = 0;
        Object.keys(_tokens.byModel).forEach((k) => delete _tokens.byModel[k]);
        _sessions.started = 0;
        _sessions.ended = 0;
        _sessions.errors = 0;
    }

    return { recordToolCall, recordUsage, recordSessionStart, recordSessionEnd, recordSessionError, getSummary, reset };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Singleton global de métricas para src/copilot. */
export const defaultMetrics = createMetricsStore();
