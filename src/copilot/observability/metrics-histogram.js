// @ts-check
/**
 * src/copilot/observability/metrics-histogram.js
 *
 * Histograma de latências com ring buffer e cálculo de percentis (p50/p95/p99). Extraído de metrics.js (F106) para
 * reduzir complexidade do módulo principal.
 *
 * @module copilot/observability/metrics-histogram
 * @see EventBus
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
 * @typedef {object} DialogMetrics
 * @property {number} turnsTotal - Total de turns executados.
 * @property {number} turnsSuccess - Turns completados com sucesso.
 * @property {number} stallsTotal - Total de stalls detectados.
 * @property {number} timeoutsTotal - Total de timeouts de turn.
 * @property {LatencyHistogram} turnLatency - Histograma de latência de turns (ms).
 * @property {number} stallSumMs - Soma acumulada de tempo stalled (ms).
 */

/**
 * @typedef {object} DialogRecoveryMetrics
 * @property {number} total - Total de tentativas de recuperação semântica do dialog.
 * @property {number} success - Recuperações concluídas com sucesso.
 * @property {number} failed - Recuperações que falharam.
 * @property {number} withoutAdditionalModelCall - Recuperações que reutilizaram o runtime sem nova chamada de modelo.
 * @property {number} withAdditionalModelCall - Recuperações que precisaram iniciar uma nova chamada de modelo.
 * @property {number} zeroPr - Alias legacy de withoutAdditionalModelCall.
 * @property {number} pr - Alias legacy de withAdditionalModelCall.
 * @property {Record<string, number>} byReason - Contagem por motivo.
 * @property {Record<string, number>} byStrategy - Contagem por estratégia.
 * @property {LatencyHistogram} latency - Histograma de duração da recuperação.
 */

/**
 * @typedef {object} SdkDialogMetrics
 * @property {number} turnsTotal - Total de turns concluídos pelo SDK/base model.
 * @property {number} turnsSuccess - Turns concluídos com sucesso no SDK.
 * @property {LatencyHistogram} turnLatency - Histograma de latência observada no SDK.
 */

/**
 * @typedef {object} InjectMetrics
 * @property {number} attemptsTotal - Total de tentativas via `/inject`.
 * @property {number} successTotal - Total de injeções concluídas dentro do SLA HTTP.
 * @property {number} timeoutsTotal - Total de injeções que expiraram por timeout.
 * @property {number} errorsTotal - Total de injeções que falharam por erro não-timeout.
 * @property {LatencyHistogram} latency - Histograma de latência da borda `/inject`.
 */

/**
 * @typedef {object} TaskMetrics
 * @property {number} completed - Total de tasks concluídas com sucesso.
 * @property {number} failed - Total de tasks com falha.
 * @property {LatencyHistogram} taskLatency - Histograma de duração de tasks (ms).
 */

/**
 * @typedef {object} SessionMetrics
 * @property {number} started - Sessões iniciadas.
 * @property {number} ended - Sessões encerradas.
 * @property {number} errors - Erros de sessão (session.error).
 * @property {number} rotations - Sessões rotacionadas por política (F43.2).
 * @property {number} keepalivePings - Pings de keepalive enviados (F42.2).
 * @property {number} cleanedUp - Sessões expiradas removidas no boot (F43.1).
 * @property {number} handoffs - Handoffs recebidos (F45).
 */

/**
 * @typedef {object} StreamingMetrics
 * @property {number} chunksTotal - Total de chunks de streaming recebidos.
 * @property {LatencyHistogram} chunkLatency - Histograma de intervalo entre chunks (ms).
 */

/**
 * @typedef {object} QuestionMetrics
 * @property {number} total - Total de questions respondidas com latência medida.
 * @property {LatencyHistogram} latency - Histograma de latência de questions (ms).
 */

/**
 * @typedef {object} MetricsSummary
 * @property {Record<string, ToolMetrics>} tools - Métricas por ferramenta.
 * @property {TokenUsageMetrics} tokens - Uso de tokens acumulado.
 * @property {SessionMetrics} sessions - Contadores de sessão.
 * @property {DialogMetrics} dialog - Métricas do dialog loop.
 * @property {DialogRecoveryMetrics} dialogRecovery - Métricas de recuperação semântica do dialog.
 * @property {SdkDialogMetrics} sdkDialog - Métricas de turnos concluídos pelo SDK.
 * @property {InjectMetrics} inject - Métricas do caminho HTTP `/inject`.
 * @property {TaskMetrics} tasks - Métricas de tasks.
 * @property {StreamingMetrics} streaming - Métricas de streaming chunks.
 * @property {QuestionMetrics} questions - Métricas de question lifecycle.
 * @property {Record<string, number>} counters - Contadores genéricos.
 * @property {Record<string, { value: number; ts: number }>} gauges - Valores instantâneos (gauges).
 * @property {number} collectedAt - Timestamp da coleta.
 */

// ─── Helpers para percentis ───────────────────────────────────────────────────

/**
 * Calcula percentil de um array ordenado.
 *
 * @param {number[]} sorted - Array ordenado crescente.
 * @param {number} p - Percentil de 0 a 100.
 * @returns {number}
 */
export function percentile(sorted, p) {
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
export function createHistogram(maxSamples = 500) {
    /** @type {number[]} */
    const _samples = [];
    let _sorted = false;
    let _min = Infinity;
    let _max = -Infinity;
    let _sum = 0;

    return {
        record(ms) {
            // FINDING-P4-1: descontar amostra removida de _sum para manter média correta
            if (_samples.length >= maxSamples) {
                const removed = _samples.shift();
                _sum -= removed ?? 0;
            }
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
            // FINDING-P4-2: recalcular min/max a partir do array ordenado (evita stale após shift)
            return {
                count: _samples.length,
                sum: _sum,
                min: _samples[0] ?? 0,
                max: _samples[_samples.length - 1] ?? 0,
                p50: percentile(_samples, 50),
                p95: percentile(_samples, 95),
                p99: percentile(_samples, 99),
            };
        },
    };
}
