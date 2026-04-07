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
 * @typedef {object} DialogMetrics
 * @property {number} turnsTotal - Total de turns executados.
 * @property {number} turnsSuccess - Turns completados com sucesso.
 * @property {number} stallsTotal - Total de stalls detectados.
 * @property {number} timeoutsTotal - Total de timeouts de turn.
 * @property {LatencyHistogram} turnLatency - Histograma de latência de turns (ms).
 * @property {number} stallSumMs - Soma acumulada de tempo stalled (ms).
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
 * @property {TaskMetrics} tasks - Métricas de tasks.
 * @property {StreamingMetrics} streaming - Métricas de streaming chunks.
 * @property {QuestionMetrics} questions - Métricas de question lifecycle.
 * @property {Record<string, number>} counters - Contadores genéricos.
 * @property {Record<string, { value: number; ts: number }>} gauges - Valores instantâneos (gauges).
 * @property {number} collectedAt - Timestamp da coleta.
 */

/**
 * @typedef {object} MetricsStore
 * @property {(toolName: string, durationMs: number, success: boolean) => void} recordToolCall
 * @property {(model: string, input?: number, output?: number, cacheRead?: number, cacheWrite?: number) => void} recordUsage
 * @property {() => void} recordSessionStart
 * @property {() => void} recordSessionEnd
 * @property {() => void} recordSessionError
 * @property {() => void} recordSessionRotation
 * @property {() => void} recordKeepalivePing
 * @property {() => void} recordSessionCleanup
 * @property {() => void} recordHandoff
 * @property {(durationMs: number, success: boolean) => void} recordDialogTurn
 * @property {(stalledMs: number) => void} recordDialogStall
 * @property {() => void} recordDialogTimeout
 * @property {(durationMs: number, success: boolean) => void} recordTaskCompletion
 * @property {(chunkMs: number) => void} recordStreamingChunk
 * @property {(waitMs: number) => void} recordQuestionLatency
 * @property {(name: string, delta?: number) => void} recordCounter
 * @property {(name: string, value: number) => void} recordGauge
 * @property {() => Record<string, { value: number; ts: number }>} getGauges
 * @property {() => MetricsSummary} getSummary
 * @property {() => void} reset
 * @property {(intervalMs?: number, logDir?: string) => void} startPeriodicSnapshot
 * @property {() => void} stopPeriodicSnapshot
 */

// ─── Helpers para percentis ───────────────────────────────────────────────────

// FINDING-P5-3: imports estáticos em vez de dynamic import dentro de setInterval
import { COPILOT_LOG_DIR, COPILOT_METRICS_SNAPSHOT_INTERVAL } from '#copilot/config/env';
import { appendFile as _appendFile, mkdir as _mkdir } from 'node:fs/promises';
import { join as _join } from 'node:path';

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

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria um MetricsStore.
 *
 * @returns {MetricsStore}
 */
export function createMetricsStore() {
    /**
     * @type {Record<
     *     string,
     *     { total: number; success: number; errors: number; histogram: ReturnType<typeof createHistogram> }
     * >}
     */
    const _tools = {};

    /** @type {TokenUsageMetrics} */
    const _tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, byModel: {} };

    /** @type {SessionMetrics} */
    const _sessions = { started: 0, ended: 0, errors: 0, rotations: 0, keepalivePings: 0, cleanedUp: 0, handoffs: 0 };

    /**
     * @type {{
     *     turnsTotal: number;
     *     turnsSuccess: number;
     *     stallsTotal: number;
     *     timeoutsTotal: number;
     *     stallSumMs: number;
     *     histogram: ReturnType<typeof createHistogram>;
     * }}
     */
    const _dialog = {
        turnsTotal: 0,
        turnsSuccess: 0,
        stallsTotal: 0,
        timeoutsTotal: 0,
        stallSumMs: 0,
        histogram: createHistogram(500),
    };

    /** @type {{ completed: number; failed: number; histogram: ReturnType<typeof createHistogram> }} */
    const _tasks = { completed: 0, failed: 0, histogram: createHistogram(500) };

    /** @type {{ chunksTotal: number; histogram: ReturnType<typeof createHistogram> }} CR-01 */
    const _streaming = { chunksTotal: 0, histogram: createHistogram(500) };

    /** @type {{ total: number; histogram: ReturnType<typeof createHistogram> }} CS-02 */
    const _questions = { total: 0, histogram: createHistogram(500) };

    /** @type {Record<string, number>} */
    const _counters = {};

    /** @type {Record<string, { value: number; ts: number }>} */
    const _gauges = {};

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
    function recordSessionRotation() {
        _sessions.rotations++;
    }
    function recordKeepalivePing() {
        _sessions.keepalivePings++;
    }
    function recordSessionCleanup() {
        _sessions.cleanedUp++;
    }
    function recordHandoff() {
        _sessions.handoffs++;
    }

    /**
     * Registra um turno do dialog loop concluído.
     *
     * @param {number} durationMs - Duração total do turn.
     * @param {boolean} success - Se o turn completou com resposta.
     * @returns {void}
     */
    function recordDialogTurn(durationMs, success) {
        _dialog.turnsTotal++;
        if (success) _dialog.turnsSuccess++;
        _dialog.histogram.record(durationMs);
    }

    /**
     * Registra um stall detectado pelo dialog watchdog.
     *
     * @param {number} stalledMs - Tempo em que o dialog ficou parado.
     * @returns {void}
     */
    function recordDialogStall(stalledMs) {
        _dialog.stallsTotal++;
        _dialog.stallSumMs += stalledMs;
    }

    /**
     * Registra um timeout de turn ou boot do dialog.
     *
     * @returns {void}
     */
    function recordDialogTimeout() {
        _dialog.timeoutsTotal++;
    }

    /**
     * Registra uma task concluída ou com falha.
     *
     * @param {number} durationMs - Duração da task.
     * @param {boolean} success - Se completou com sucesso.
     * @returns {void}
     */
    function recordTaskCompletion(durationMs, success) {
        if (success) _tasks.completed++;
        else _tasks.failed++;
        _tasks.histogram.record(durationMs);
    }

    /**
     * CR-01: Registra intervalo entre chunks de streaming (ms).
     *
     * @param {number} chunkMs - Intervalo desde o chunk anterior (ms).
     * @returns {void}
     */
    function recordStreamingChunk(chunkMs) {
        _streaming.chunksTotal++;
        _streaming.histogram.record(chunkMs);
    }

    /**
     * CS-02: Registra latência de resposta a question (ms).
     *
     * @param {number} waitMs - Tempo entre question.pending e question.answered (ms).
     * @returns {void}
     */
    function recordQuestionLatency(waitMs) {
        _questions.total++;
        _questions.histogram.record(waitMs);
    }

    /**
     * Incrementa um contador genérico.
     *
     * @param {string} name - Nome do contador.
     * @param {number} [delta=1] - Valor a incrementar. Default is `1`
     * @returns {void}
     */
    function recordCounter(name, delta = 1) {
        _counters[name] = (_counters[name] ?? 0) + delta;
    }

    /**
     * Registra um valor instantâneo (gauge) — sobrescreve o anterior.
     *
     * @param {string} name - Nome do gauge.
     * @param {number} value - Valor atual.
     * @returns {void}
     */
    function recordGauge(name, value) {
        _gauges[name] = { value, ts: Date.now() };
    }

    /**
     * Retorna todos os gauges registrados.
     *
     * @returns {Record<string, { value: number; ts: number }>}
     */
    function getGauges() {
        return { ..._gauges };
    }

    /** @type {ReturnType<typeof setInterval> | null} */
    let _snapshotTimer = null;

    /**
     * Inicia snapshot periódico de métricas em arquivo.
     *
     * @param {number} [intervalMs] - Intervalo entre snapshots. Default: COPILOT_METRICS_SNAPSHOT_INTERVAL ou 5min.
     * @param {string} [logDir] - Diretório de log. Default: src/copilot/logs/.
     * @returns {void}
     */
    function startPeriodicSnapshot(intervalMs, logDir) {
        stopPeriodicSnapshot();
        const ms = intervalMs ?? COPILOT_METRICS_SNAPSHOT_INTERVAL;
        if (ms <= 0) return;
        const resolvedDir = logDir ?? (COPILOT_LOG_DIR || './src/copilot/logs');
        _snapshotTimer = setInterval(() => {
            void (async () => {
                try {
                    // FINDING-P5-3: usar imports estáticos em vez de dynamic import a cada tick
                    await _mkdir(resolvedDir, { recursive: true });
                    const line = JSON.stringify({ _snapshot: new Date().toISOString(), ...getSummary() }) + '\n';
                    await _appendFile(_join(resolvedDir, 'metrics.jsonl'), line, 'utf8');
                } catch {
                    // Falha silenciosa — métricas não devem bloquear
                }
            })();
        }, ms);
        if (_snapshotTimer.unref) _snapshotTimer.unref();
    }

    /**
     * Para o snapshot periódico.
     *
     * @returns {void}
     */
    function stopPeriodicSnapshot() {
        if (_snapshotTimer) {
            clearInterval(_snapshotTimer);
            _snapshotTimer = null;
        }
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
            dialog: {
                turnsTotal: _dialog.turnsTotal,
                turnsSuccess: _dialog.turnsSuccess,
                stallsTotal: _dialog.stallsTotal,
                timeoutsTotal: _dialog.timeoutsTotal,
                turnLatency: _dialog.histogram.snapshot(),
                stallSumMs: _dialog.stallSumMs,
            },
            tasks: {
                completed: _tasks.completed,
                failed: _tasks.failed,
                taskLatency: _tasks.histogram.snapshot(),
            },
            streaming: {
                chunksTotal: _streaming.chunksTotal,
                chunkLatency: _streaming.histogram.snapshot(),
            },
            questions: {
                total: _questions.total,
                latency: _questions.histogram.snapshot(),
            },
            counters: { ..._counters },
            gauges: { ..._gauges },
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
        _sessions.rotations = 0;
        _sessions.keepalivePings = 0;
        _sessions.cleanedUp = 0;
        _sessions.handoffs = 0;
        _dialog.turnsTotal = 0;
        _dialog.turnsSuccess = 0;
        _dialog.stallsTotal = 0;
        _dialog.timeoutsTotal = 0;
        _dialog.stallSumMs = 0;
        _dialog.histogram = createHistogram(500);
        _tasks.completed = 0;
        _tasks.failed = 0;
        _tasks.histogram = createHistogram(500);
        _streaming.chunksTotal = 0;
        _streaming.histogram = createHistogram(500);
        _questions.total = 0;
        _questions.histogram = createHistogram(500);
        Object.keys(_counters).forEach((k) => delete _counters[k]);
        Object.keys(_gauges).forEach((k) => delete _gauges[k]);
    }

    return {
        recordToolCall,
        recordUsage,
        recordSessionStart,
        recordSessionEnd,
        recordSessionError,
        recordSessionRotation,
        recordKeepalivePing,
        recordSessionCleanup,
        recordHandoff,
        recordDialogTurn,
        recordDialogStall,
        recordDialogTimeout,
        recordTaskCompletion,
        recordStreamingChunk,
        recordQuestionLatency,
        recordCounter,
        recordGauge,
        getGauges,
        getSummary,
        reset,
        startPeriodicSnapshot,
        stopPeriodicSnapshot,
    };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Singleton global de métricas para src/copilot. */
export const defaultMetrics = createMetricsStore();
