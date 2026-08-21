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
/** @typedef {import('./metrics-histogram.js').DialogRecoveryMetrics} DialogRecoveryMetrics */
/** @typedef {import('./metrics-histogram.js').SdkDialogMetrics} SdkDialogMetrics */
/** @typedef {import('./metrics-histogram.js').InjectMetrics} InjectMetrics */
/** @typedef {import('./metrics-histogram.js').TaskMetrics} TaskMetrics */
/** @typedef {import('./metrics-histogram.js').SessionMetrics} SessionMetrics */
/** @typedef {import('./metrics-histogram.js').StreamingMetrics} StreamingMetrics */
/** @typedef {import('./metrics-histogram.js').QuestionMetrics} QuestionMetrics */
/** @typedef {import('./metrics-histogram.js').MetricsSummary} MetricsSummary */
import { cancelTimer, registerInterval } from '#copilot/core';
import { createToolTelemetryStore, defaultToolTelemetryStore } from './tool-stats.js';

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
 * @property {(
 *     reason: string,
 *     opts?: {
 *         strategy?: string;
 *         additionalModelCall?: boolean;
 *         prConsumed?: boolean;
 *         success?: boolean;
 *         durationMs?: number;
 *     },
 * ) => void} recordDialogRecovery
 * @property {(durationMs: number, success: boolean) => void} recordSdkDialogTurn
 * @property {(durationMs: number, success: boolean, outcome?: 'completed' | 'timeout' | 'error') => void} recordInjectTurn
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
 * @property {() => Promise<void>} flushPeriodicSnapshot
 * @property {() => void} [recordQuotaPoll] - Registra uma sondagem de quota (opcional)
 */

// FINDING-P5-3: imports estáticos em vez de dynamic import dentro de setInterval
import { COPILOT_LOG_DIR, COPILOT_METRICS_SNAPSHOT_INTERVAL } from '#copilot/config';
import { createJsonlFileWriter } from '#copilot/infra/public/persistence/jsonl';
import { join as _join } from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { createHistogram } from './metrics-histogram.js';

/**
 * Cria um MetricsStore.
 *
 * @param {{ toolTelemetry?: import('./tool-stats.js').ToolTelemetryStore }} [options]
 * @returns {MetricsStore}
 */
export function createMetricsStore(options = {}) {
    const toolTelemetry = options.toolTelemetry ?? createToolTelemetryStore();
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

    /**
     * @type {{
     *     total: number;
     *     success: number;
     *     failed: number;
     *     withoutAdditionalModelCall: number;
     *     withAdditionalModelCall: number;
     *     zeroPr: number;
     *     pr: number;
     *     byReason: Record<string, number>;
     *     byStrategy: Record<string, number>;
     *     histogram: ReturnType<typeof createHistogram>;
     * }}
     */
    const _dialogRecovery = {
        total: 0,
        success: 0,
        failed: 0,
        withoutAdditionalModelCall: 0,
        withAdditionalModelCall: 0,
        zeroPr: 0,
        pr: 0,
        byReason: {},
        byStrategy: {},
        histogram: createHistogram(200),
    };

    /** @type {{ turnsTotal: number; turnsSuccess: number; histogram: ReturnType<typeof createHistogram> }} */
    const _sdkDialog = {
        turnsTotal: 0,
        turnsSuccess: 0,
        histogram: createHistogram(500),
    };

    /**
     * @type {{
     *     attemptsTotal: number;
     *     successTotal: number;
     *     timeoutsTotal: number;
     *     errorsTotal: number;
     *     histogram: ReturnType<typeof createHistogram>;
     * }}
     */
    const _inject = {
        attemptsTotal: 0,
        successTotal: 0,
        timeoutsTotal: 0,
        errorsTotal: 0,
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
        toolTelemetry.recordToolCall(toolName, durationMs, success);
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
     * Registra uma recuperação semântica do dialog loop.
     *
     * @param {string} reason
     * @param {{
     *     strategy?: string;
     *     additionalModelCall?: boolean;
     *     prConsumed?: boolean;
     *     success?: boolean;
     *     durationMs?: number;
     * }} [opts]
     * @returns {void}
     */
    function recordDialogRecovery(reason, opts = {}) {
        const normalizedReason = reason || 'unknown';
        const strategy = opts.strategy || 'unknown';
        const success = opts.success !== false;
        _dialogRecovery.total++;
        if (success) _dialogRecovery.success++;
        else _dialogRecovery.failed++;
        const additionalModelCall = opts.additionalModelCall === true || opts.prConsumed === true;
        if (additionalModelCall) {
            _dialogRecovery.withAdditionalModelCall++;
            _dialogRecovery.pr++; // legacy alias
        } else {
            _dialogRecovery.withoutAdditionalModelCall++;
            _dialogRecovery.zeroPr++; // legacy alias
        }
        _dialogRecovery.byReason[normalizedReason] = (_dialogRecovery.byReason[normalizedReason] ?? 0) + 1;
        _dialogRecovery.byStrategy[strategy] = (_dialogRecovery.byStrategy[strategy] ?? 0) + 1;
        _dialogRecovery.histogram.record(Math.max(0, Math.round(opts.durationMs ?? 0)));
    }

    /**
     * Registra um turno concluído pelo SDK/base model, separado da semântica HTTP do `/inject`.
     *
     * @param {number} durationMs
     * @param {boolean} success
     * @returns {void}
     */
    function recordSdkDialogTurn(durationMs, success) {
        _sdkDialog.turnsTotal++;
        if (success) _sdkDialog.turnsSuccess++;
        _sdkDialog.histogram.record(durationMs);
    }

    /**
     * Registra o resultado da borda `/inject`, incluindo timeouts HTTP.
     *
     * @param {number} durationMs
     * @param {boolean} success
     * @param {'completed' | 'timeout' | 'error'} [outcome='completed'] Default is `'completed'`
     * @returns {void}
     */
    function recordInjectTurn(durationMs, success, outcome = 'completed') {
        _inject.attemptsTotal++;
        if (success) _inject.successTotal++;
        else if (outcome === 'timeout') _inject.timeoutsTotal++;
        else _inject.errorsTotal++;
        _inject.histogram.record(durationMs);
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
    /** @type {string | null} */
    let _snapshotTimerId = null;
    /** @type {ReturnType<typeof createJsonlFileWriter> | null} */
    let _snapshotWriter = null;

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
        const previousWriter = _snapshotWriter;
        if (previousWriter) {
            void previousWriter.flush().catch((error) => logSwallowed(error, 'metrics.snapshot.restart'));
        }
        _snapshotWriter = createJsonlFileWriter({
            filePath: _join(resolvedDir, 'metrics.jsonl'),
            batchLines: 32,
            maxQueueLines: 10_000,
            softQueueLines: 1_000,
            onError: (error) => logSwallowed(error, 'metrics.snapshot'),
        });
        const writer = _snapshotWriter;
        _snapshotTimerId = `metrics.snapshot:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        _snapshotTimer = registerInterval(
            _snapshotTimerId,
            () => {
                const line = JSON.stringify({ _snapshot: new Date().toISOString(), ...getSummary() }) + '\n';
                writer.enqueueLine(line);
            },
            ms,
        );
        if (_snapshotTimer.unref) _snapshotTimer.unref();
    }

    /**
     * Para o snapshot periódico.
     *
     * @returns {void}
     */
    function stopPeriodicSnapshot() {
        if (_snapshotTimer) {
            if (_snapshotTimerId) cancelTimer(_snapshotTimerId);
            _snapshotTimer = null;
            _snapshotTimerId = null;
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async function flushPeriodicSnapshot() {
        await _snapshotWriter?.flush();
    }

    /**
     * @returns {MetricsSummary}
     */
    function getSummary() {
        /** @type {Record<string, ToolMetrics>} */
        const tools = /** @type {Record<string, ToolMetrics>} */ (toolTelemetry.getToolMetricsSummary());
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
            dialogRecovery: {
                total: _dialogRecovery.total,
                success: _dialogRecovery.success,
                failed: _dialogRecovery.failed,
                withoutAdditionalModelCall: _dialogRecovery.withoutAdditionalModelCall,
                withAdditionalModelCall: _dialogRecovery.withAdditionalModelCall,
                zeroPr: _dialogRecovery.zeroPr,
                pr: _dialogRecovery.pr,
                byReason: { ..._dialogRecovery.byReason },
                byStrategy: { ..._dialogRecovery.byStrategy },
                latency: _dialogRecovery.histogram.snapshot(),
            },
            sdkDialog: {
                turnsTotal: _sdkDialog.turnsTotal,
                turnsSuccess: _sdkDialog.turnsSuccess,
                turnLatency: _sdkDialog.histogram.snapshot(),
            },
            inject: {
                attemptsTotal: _inject.attemptsTotal,
                successTotal: _inject.successTotal,
                timeoutsTotal: _inject.timeoutsTotal,
                errorsTotal: _inject.errorsTotal,
                latency: _inject.histogram.snapshot(),
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
        toolTelemetry.reset();
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
        _dialogRecovery.total = 0;
        _dialogRecovery.success = 0;
        _dialogRecovery.failed = 0;
        _dialogRecovery.withoutAdditionalModelCall = 0;
        _dialogRecovery.withAdditionalModelCall = 0;
        _dialogRecovery.zeroPr = 0;
        _dialogRecovery.pr = 0;
        Object.keys(_dialogRecovery.byReason).forEach((k) => delete _dialogRecovery.byReason[k]);
        Object.keys(_dialogRecovery.byStrategy).forEach((k) => delete _dialogRecovery.byStrategy[k]);
        _dialogRecovery.histogram = createHistogram(200);
        _sdkDialog.turnsTotal = 0;
        _sdkDialog.turnsSuccess = 0;
        _sdkDialog.histogram = createHistogram(500);
        _inject.attemptsTotal = 0;
        _inject.successTotal = 0;
        _inject.timeoutsTotal = 0;
        _inject.errorsTotal = 0;
        _inject.histogram = createHistogram(500);
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
        recordDialogRecovery,
        recordSdkDialogTurn,
        recordInjectTurn,
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
        flushPeriodicSnapshot,
    };
}

/**
 * Singleton global de métricas para src/copilot.
 *
 * Implementa {@link import('../core/interfaces.js').IMetricsCollector IMetricsCollector} (Faixa 3.2 — AC-5-07).
 *
 * @type {MetricsStore}
 */
export const defaultMetrics = createMetricsStore({ toolTelemetry: defaultToolTelemetryStore });
