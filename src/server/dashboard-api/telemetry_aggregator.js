// @ts-check
import * as hardware from '#core/hardware';
import { log } from '#core/logger';
import { getDb } from '#infra/db/sqlite';

/**
 * Ring Buffer para armazenamento eficiente de métricas históricas. Mantém tamanho fixo, descartando valores antigos
 * automaticamente.
 */
class RingBuffer {
    constructor(maxSize = 3600) {
        this.maxSize = maxSize;
        /** @type {any[]} */
        this.buffer = [];
    }

    push(/** @type {any} */ value) {
        this.buffer.push({
            value,
            timestamp: Date.now(),
        });

        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    getAll() {
        return [...this.buffer];
    }

    getLast(n = 60) {
        return this.buffer.slice(-n);
    }

    getRange(/** @type {any} */ fromTimestamp, /** @type {any} */ toTimestamp) {
        return this.buffer.filter((item) => item.timestamp >= fromTimestamp && item.timestamp <= toTimestamp);
    }

    getAverage() {
        if (this.buffer.length === 0) return 0;
        const sum = this.buffer.reduce((acc, item) => acc + item.value, 0);
        return sum / this.buffer.length;
    }

    getMax() {
        if (this.buffer.length === 0) return 0;
        return Math.max(...this.buffer.map((item) => item.value));
    }

    getMin() {
        if (this.buffer.length === 0) return 0;
        return Math.min(...this.buffer.map((item) => item.value));
    }

    clear() {
        /** @type {any[]} */
        this.buffer = [];
    }

    get size() {
        return this.buffer.length;
    }
}

/**
 * TelemetryAggregator - Agregador Central de Telemetria
 *
 * Coleta e armazena métricas de múltiplas fontes:
 *
 * - Hardware (CPU, Memory, Heap)
 * - NERV (latência, throughput, eventos)
 * - Queue (tamanho, hit rate)
 * - Event Loop (lag)
 *
 * Arquitetura:
 *
 * - Singleton pattern para acesso global
 * - Coleta a 1Hz (1 amostra/segundo)
 * - Ring buffers de 3600 amostras (1 hora)
 * - Broadcast via Socket.io
 */
class TelemetryAggregator {
    constructor() {
        // Ring buffers para métricas históricas (1 hora @ 1Hz = 3600 samples)
        this.cpuHistory = new RingBuffer(3600);
        this.memoryHistory = new RingBuffer(3600);
        this.heapHistory = new RingBuffer(3600);
        this.eventLoopLagHistory = new RingBuffer(3600);
        this.nervLatencyHistory = new RingBuffer(3600);
        this.nervThroughputHistory = new RingBuffer(3600);
        this.queueSizeHistory = new RingBuffer(3600);

        // Última coleta de métricas
        this.lastMetrics = null;

        // Referência ao Socket.io Hub
        this.socketHub = null;

        // DB SSOT (SQLite) — Queue metrics come from DB now

        // Interval de coleta
        this.collectionInterval = null;

        // B007: reentrancy guard para _collectAndBroadcast (evita coletas sobrepostas)
        this._collecting = false;

        // Contadores
        this.totalSamples = 0;
        this.startTime = null;

        // Thresholds para alertas
        this.alertThresholds = {
            cpu_percent: 90,
            memory_percent: 95,
            heap_percent: 90,
            event_loop_lag_ms: 100,
            queue_size: 1000,
        };

        // Alertas ativos
        this.activeAlerts = new Map();

        log('INFO', '[TelemetryAggregator] Instância criada');
    }

    /**
     * Inicializa o agregador e começa coleta.
     *
     * @param {object} [options]
     * @param {object} [options.socketHub] - Socket.io Hub para broadcast
     * @param {number} [options.intervalMs] - Intervalo de coleta em ms (default: 1000)
     */
    start(options = {}) {
        const { socketHub, intervalMs = 1000 } = options;
        if (this.collectionInterval) {
            log('WARN', '[TelemetryAggregator] Já está rodando');
            return;
        }

        this.socketHub = socketHub;
        this.startTime = Date.now();

        // Coleta inicial
        void this._collectAndBroadcast();

        // Inicia loop de coleta
        this.collectionInterval = setInterval(() => {
            void this._collectAndBroadcast();
        }, intervalMs);

        log('INFO', `[TelemetryAggregator] Iniciado (intervalo: ${intervalMs}ms)`);
    }

    /**
     * Para a coleta de métricas.
     */
    stop() {
        if (this.collectionInterval) {
            clearInterval(this.collectionInterval);
            this.collectionInterval = null;
            log('INFO', '[TelemetryAggregator] Parado');
        }
    }

    /**
     * Coleta métricas e envia para dashboards.
     */
    async _collectAndBroadcast() {
        // B007: evita coletas concorrentes quando o setInterval dispara durante coleta anterior
        if (this._collecting) {
            return;
        }
        this._collecting = true;
        try {
            const metrics = await this._collectMetrics();
            this.lastMetrics = metrics;
            this.totalSamples++;

            // Adiciona aos ring buffers
            this._addToBuffers(metrics);

            // Verifica thresholds e emite alertas
            this._checkThresholds(metrics);

            // Broadcast via Socket.io
            this._broadcast(metrics);
        } catch (/** @type {any} */ err) {
            const _e = /** @type {any} */ (err);
            log('ERROR', `[TelemetryAggregator] Erro na coleta: ${_e.message}`);
        } finally {
            this._collecting = false;
        }
    }

    /**
     * Coleta todas as métricas do sistema.
     */
    async _collectMetrics() {
        // Hardware metrics
        const hwMetrics = hardware.getAllMetrics();

        // Queue metrics
        let queueMetrics = { size: 0, running: 0 };
        try {
            const db = getDb();
            queueMetrics = {
                size:
                    /** @type {any} */ (
                        db.prepare("SELECT COUNT(1) AS c FROM tasks WHERE stage='READY' AND status='PENDING'").get()
                    )?.c || 0,
                running:
                    /** @type {any} */ (db.prepare("SELECT COUNT(1) AS c FROM tasks WHERE status='RUNNING'").get())
                        ?.c || 0,
            };
        } catch (/** @type {any} */ _) {
            // Best-effort: DB might not be available in some modes/tests
        }

        // Event loop lag
        const eventLoopLag = await this._measureEventLoopLag();

        // NERV metrics (placeholder - será integrado quando disponível)
        const nervMetrics = {
            latency_ms: 0,
            throughput: 0,
            event_count: 0,
        };

        return {
            timestamp: Date.now(),
            uptime_seconds: Math.round((Date.now() - Number(this.startTime)) / 1000),
            sample_number: this.totalSamples,

            cpu: {
                usage_percent: Number(hwMetrics.cpu.usage_percent) || 0,
                load_1min: parseFloat(hwMetrics.cpu.load_1min) || 0,
                load_5min: parseFloat(hwMetrics.cpu.load_5min) || 0,
                load_15min: parseFloat(hwMetrics.cpu.load_15min) || 0,
                cores: hwMetrics.cpu.cores || 1,
            },

            memory: {
                total_mb: hwMetrics.memory.total_mb,
                used_mb: hwMetrics.memory.used_mb,
                free_mb: hwMetrics.memory.free_mb,
                usage_percent: hwMetrics.memory.usage_percent,
            },

            heap: {
                used_mb: hwMetrics.heap.heap_used_mb,
                total_mb: hwMetrics.heap.heap_total_mb,
                limit_mb: hwMetrics.heap.heap_limit_mb,
                usage_percent: hwMetrics.heap.heap_usage_percent,
            },

            event_loop: {
                lag_ms: eventLoopLag,
            },

            nerv: nervMetrics,

            queue: queueMetrics,

            system: {
                platform: hwMetrics.system.platform,
                node_version: hwMetrics.system.node_version,
                pid: hwMetrics.system.pid,
            },
        };
    }

    /**
     * Mede latência do event loop. Usa setImmediate para medir tempo até próximo tick.
     */
    async _measureEventLoopLag() {
        const start = Date.now();
        await new Promise((resolve) => setImmediate(resolve));
        return Date.now() - start;
    }

    /**
     * Adiciona métricas aos ring buffers.
     */
    _addToBuffers(/** @type {any} */ metrics) {
        this.cpuHistory.push(metrics.cpu.usage_percent);
        this.memoryHistory.push(metrics.memory.usage_percent);
        this.heapHistory.push(metrics.heap.usage_percent);
        this.eventLoopLagHistory.push(metrics.event_loop.lag_ms);
        this.nervLatencyHistory.push(metrics.nerv.latency_ms);
        this.nervThroughputHistory.push(metrics.nerv.throughput);
        this.queueSizeHistory.push(metrics.queue.size);
    }

    /**
     * Verifica thresholds e emite alertas se necessário.
     */
    _checkThresholds(/** @type {any} */ metrics) {
        const checks = [
            {
                name: 'high_cpu',
                condition: metrics.cpu.usage_percent > this.alertThresholds.cpu_percent,
                message: `CPU usage at ${metrics.cpu.usage_percent}%`,
                severity: 'warning',
            },
            {
                name: 'high_memory',
                condition: metrics.memory.usage_percent > this.alertThresholds.memory_percent,
                message: `Memory usage at ${metrics.memory.usage_percent}%`,
                severity: 'warning',
            },
            {
                name: 'high_heap',
                condition: metrics.heap.usage_percent > this.alertThresholds.heap_percent,
                message: `Heap usage at ${metrics.heap.usage_percent}%`,
                severity: 'warning',
            },
            {
                name: 'event_loop_lag',
                condition: metrics.event_loop.lag_ms > this.alertThresholds.event_loop_lag_ms,
                message: `Event loop lag: ${metrics.event_loop.lag_ms}ms`,
                severity: 'warning',
            },
            {
                name: 'queue_overflow',
                condition: metrics.queue.size > this.alertThresholds.queue_size,
                message: `Queue size: ${metrics.queue.size} tasks`,
                severity: 'critical',
            },
        ];

        for (const check of checks) {
            if (check.condition) {
                if (!this.activeAlerts.has(check.name)) {
                    // Novo alerta
                    const alert = {
                        id: `${check.name}_${Date.now()}`,
                        name: check.name,
                        message: check.message,
                        severity: check.severity,
                        triggered_at: Date.now(),
                    };

                    this.activeAlerts.set(check.name, alert);
                    this._broadcastAlert(alert);

                    log('WARN', `[TelemetryAggregator] Alert: ${check.message}`);
                }
            } else {
                // Clear alert se condição não mais verdadeira
                if (this.activeAlerts.has(check.name)) {
                    this.activeAlerts.delete(check.name);
                }
            }
        }
    }

    /**
     * Broadcast métricas para dashboards via Socket.io.
     */
    _broadcast(/** @type {any} */ metrics) {
        if (!this.socketHub) return;

        try {
            if (typeof (/** @type {any} */ (this.socketHub).notify) === 'function') {
                /** @type {any} */ (this.socketHub).notify('telemetry:metrics', metrics);
            } else if (typeof (/** @type {any} */ (this.socketHub).emit) === 'function') {
                /** @type {any} */ (this.socketHub).emit('telemetry:metrics', metrics);
            }
        } catch (/** @type {any} */ err) {

            // Ignora erros de broadcast
        }
    }

    /**
     * Broadcast alerta para dashboards.
     */
    _broadcastAlert(/** @type {any} */ alert) {
        if (!this.socketHub) return;

        try {
            if (typeof (/** @type {any} */ (this.socketHub).notify) === 'function') {
                /** @type {any} */ (this.socketHub).notify('alert:triggered', alert);
            }
        } catch (/** @type {any} */ err) {

            // Ignora erros
        }
    }

    /**
     * API: Retorna métricas atuais.
     *
     * @returns {Promise<any>} Métricas coletadas
     */
    async getCurrent() {
        return this.lastMetrics || (await this._collectMetrics());
    }

    /**
     * API: Retorna histórico de uma métrica específica.
     *
     * @param {string} metric - Nome da métrica (cpu, memory, heap, etc.)
     * @param {number} samples - Número de amostras (default: 60)
     */
    getHistory(metric, samples = 60) {
        const bufferMap = {
            cpu: this.cpuHistory,
            memory: this.memoryHistory,
            heap: this.heapHistory,
            event_loop: this.eventLoopLagHistory,
            nerv_latency: this.nervLatencyHistory,
            nerv_throughput: this.nervThroughputHistory,
            queue: this.queueSizeHistory,
        };

        const buffer = /** @type {Record<string, any>} */ (bufferMap)[metric];
        if (!buffer) {
            return { error: `Unknown metric: ${metric}` };
        }

        const data = buffer.getLast(samples);

        return {
            metric,
            samples: data.length,
            data: data.map((/** @type {any} */ item) => ({
                value: item.value,
                timestamp: item.timestamp,
            })),
            stats: {
                average: buffer.getAverage(),
                max: buffer.getMax(),
                min: buffer.getMin(),
            },
        };
    }

    /**
     * API: Retorna todas as métricas históricas com stats.
     */
    getFullHistory() {
        return {
            timestamp: Date.now(),
            total_samples: this.totalSamples,
            uptime_seconds: this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0,

            cpu: {
                current: this.cpuHistory.buffer[this.cpuHistory.buffer.length - 1]?.value || 0,
                average: this.cpuHistory.getAverage(),
                max: this.cpuHistory.getMax(),
                history: this.cpuHistory.getLast(60),
            },

            memory: {
                current: this.memoryHistory.buffer[this.memoryHistory.buffer.length - 1]?.value || 0,
                average: this.memoryHistory.getAverage(),
                max: this.memoryHistory.getMax(),
                history: this.memoryHistory.getLast(60),
            },

            heap: {
                current: this.heapHistory.buffer[this.heapHistory.buffer.length - 1]?.value || 0,
                average: this.heapHistory.getAverage(),
                max: this.heapHistory.getMax(),
                history: this.heapHistory.getLast(60),
            },

            event_loop: {
                current: this.eventLoopLagHistory.buffer[this.eventLoopLagHistory.buffer.length - 1]?.value || 0,
                average: this.eventLoopLagHistory.getAverage(),
                max: this.eventLoopLagHistory.getMax(),
                history: this.eventLoopLagHistory.getLast(60),
            },

            queue: {
                current: this.queueSizeHistory.buffer[this.queueSizeHistory.buffer.length - 1]?.value || 0,
                average: this.queueSizeHistory.getAverage(),
                max: this.queueSizeHistory.getMax(),
                history: this.queueSizeHistory.getLast(60),
            },
        };
    }

    /**
     * API: Retorna alertas ativos.
     */
    getActiveAlerts() {
        return Array.from(this.activeAlerts.values());
    }

    /**
     * API: Atualiza thresholds de alerta.
     */
    setAlertThresholds(/** @type {any} */ thresholds) {
        this.alertThresholds = {
            ...this.alertThresholds,
            ...thresholds,
        };
        log('INFO', `[TelemetryAggregator] Thresholds atualizados: ${JSON.stringify(thresholds)}`);
    }

    /**
     * Limpa todos os buffers e reseta estado.
     */
    reset() {
        this.cpuHistory.clear();
        this.memoryHistory.clear();
        this.heapHistory.clear();
        this.eventLoopLagHistory.clear();
        this.nervLatencyHistory.clear();
        this.nervThroughputHistory.clear();
        this.queueSizeHistory.clear();
        this.activeAlerts.clear();
        this.totalSamples = 0;
        this.lastMetrics = null;
        log('INFO', '[TelemetryAggregator] Reset completo');
    }
}

// Singleton instance
/** Constante/valor exportado: default. */
const telemetryAggregator = new TelemetryAggregator();

export default telemetryAggregator;
export { RingBuffer, TelemetryAggregator };
