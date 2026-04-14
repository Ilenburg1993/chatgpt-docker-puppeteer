// @ts-check
/**
 * @module copilot/observability/metrics
 * @file Store centralizado de métricas: latência de tools, tokens, turnos, sessões e streaming. Expõe histogramas,
 *   contadores e resumos para dashboards e health checks.
 *
 *   src/copilot/observability/metrics.js
 * @see EventBus
 */

/** @typedef {import('./metrics-histogram.js').LatencyHistogram} LatencyHistogram */
/** @typedef {import('./metrics-histogram.js').ToolMetrics} ToolMetrics */
/** @typedef {import('./metrics-histogram.js').TokenUsageMetrics} TokenUsageMetrics */
/** @typedef {import('./metrics-histogram.js').DialogMetrics} DialogMetrics */
/** @typedef {import('./metrics-histogram.js').TaskMetrics} TaskMetrics */
/** @typedef {import('./metrics-histogram.js').SessionMetrics} SessionMetrics */
/** @typedef {import('./metrics-histogram.js').StreamingMetrics} StreamingMetrics */
/** @typedef {import('./metrics-histogram.js').QuestionMetrics} QuestionMetrics */
/** @typedef {import('./metrics-histogram.js').MetricsSummary} MetricsSummary */

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
 * @property {() => void} [recordQuotaPoll] - Registra uma sondagem de quota (opcional)
 */

// FINDING-P5-3: imports estáticos em vez de dynamic import dentro de setInterval
import { COPILOT_LOG_DIR, COPILOT_METRICS_SNAPSHOT_INTERVAL } from '#copilot/config';
import { appendFile as _appendFile, mkdir as _mkdir } from 'node:fs/promises';
import { join as _join } from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { cancel as cancelTimer, registerTimer } from '../core/timer-registry.js';
import { createHistogram } from './metrics-histogram.js';

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
     * @param {string} [logDir] - Diretório de log. Default: var/logs/copilot/.
     * @returns {void}
     */
    function startPeriodicSnapshot(intervalMs, logDir) {
        stopPeriodicSnapshot();
        const ms = intervalMs ?? COPILOT_METRICS_SNAPSHOT_INTERVAL;
        if (ms <= 0) return;
        const resolvedDir = logDir ?? (COPILOT_LOG_DIR || './var/logs/copilot');
        _snapshotTimer = setInterval(() => {
            void (async () => {
                try {
                    // FINDING-P5-3: usar imports estáticos em vez de dynamic import a cada tick
                    await _mkdir(resolvedDir, { recursive: true });
                    const line = JSON.stringify({ _snapshot: new Date().toISOString(), ...getSummary() }) + '\n';
                    await _appendFile(_join(resolvedDir, 'metrics.jsonl'), line, 'utf8');
                } catch (/** @type {any} */ e) {
                    logSwallowed(e, 'metrics.snapshot');
                }
            })();
        }, ms);
        if (_snapshotTimer.unref) _snapshotTimer.unref();
        // F155: registrar no timer-registry para cleanup automático via shutdown
        registerTimer('metrics.snapshot', 'interval', _snapshotTimer);
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
            // F155: cancelar também no registry (idempotente)
            cancelTimer('metrics.snapshot');
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

/**
 * Singleton global de métricas para src/copilot.
 *
 * Implementa {@link import('../core/interfaces.js').IMetricsCollector IMetricsCollector} (Faixa 3.2 — AC-5-07).
 *
 * @type {MetricsStore}
 */
export const defaultMetrics = createMetricsStore();
