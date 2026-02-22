/**
 * Pinia Store: Telemetry
 *
 * Gerencia métricas de telemetria no dashboard.
 * - Recebe métricas em tempo real via Socket.io
 * - Mantém histórico local para gráficos
 * - Carrega histórico da API
 */

import { defineStore } from 'pinia';
import { formatHttpError, http } from '@/lib/http';

/**
 * Ring buffer simples para histórico de métricas
 */
class MetricBuffer {
    constructor(maxSize = 120) {
        this.maxSize = maxSize;
        this.data = [];
    }

    push(value, timestamp = Date.now()) {
        this.data.push({ value, timestamp });
        if (this.data.length > this.maxSize) {
            this.data.shift();
        }
    }

    getAll() {
        return [...this.data];
    }

    getLast(n = 60) {
        return this.data.slice(-n);
    }

    clear() {
        this.data = [];
    }

    get latest() {
        return this.data[this.data.length - 1]?.value || 0;
    }

    get average() {
        if (this.data.length === 0) return 0;
        return this.data.reduce((sum, item) => sum + item.value, 0) / this.data.length;
    }

    get max() {
        if (this.data.length === 0) return 0;
        return Math.max(...this.data.map(item => item.value));
    }
}

/** Constante/valor exportado: useTelemetryStore. */
export const useTelemetryStore = defineStore('telemetry', {
    state: () => ({
        // Métricas atuais
        current: {
            timestamp: null,
            cpu: { usage_percent: 0, load_1min: 0, load_5min: 0, load_15min: 0, cores: 1 },
            memory: { total_mb: 0, used_mb: 0, free_mb: 0, usage_percent: 0 },
            heap: { used_mb: 0, total_mb: 0, limit_mb: 0, usage_percent: 0 },
            event_loop: { lag_ms: 0 },
            nerv: { latency_ms: 0, throughput: 0, event_count: 0 },
            queue: { size: 0, hitRate: 0 },
            system: {},
        },

        // Buffers de histórico local
        history: {
            cpu: new MetricBuffer(120),
            memory: new MetricBuffer(120),
            heap: new MetricBuffer(120),
            eventLoop: new MetricBuffer(120),
            queueSize: new MetricBuffer(120),
        },

        // Status de conexão
        connected: false,
        receiving: false,
        lastReceived: null,

        // Estatísticas
        samplesReceived: 0,

        // Erro
        error: null,
    }),

    getters: {
        /**
         * Uso de CPU atual (% real)
         */
        cpuLoad: state => state.current.cpu.usage_percent,

        /**
         * Load average de 1 min (não percentual)
         */
        cpuLoad1m: state => state.current.cpu.load_1min,

        /**
         * Uso de memória em %
         */
        memoryUsage: state => state.current.memory.usage_percent,

        /**
         * Uso de heap em %
         */
        heapUsage: state => state.current.heap.usage_percent,

        /**
         * Lag do event loop em ms
         */
        eventLoopLag: state => state.current.event_loop.lag_ms,

        /**
         * Tamanho da fila
         */
        queueSize: state => state.current.queue.size,

        /**
         * Histórico de CPU (últimos 60 pontos)
         */
        cpuHistory: state => state.history.cpu.getLast(60),

        /**
         * Histórico de memória (últimos 60 pontos)
         */
        memoryHistory: state => state.history.memory.getLast(60),

        /**
         * Histórico de heap (últimos 60 pontos)
         */
        heapHistory: state => state.history.heap.getLast(60),

        /**
         * Médias
         */
        averages: state => ({
            cpu: state.history.cpu.average.toFixed(2),
            memory: state.history.memory.average.toFixed(1),
            heap: state.history.heap.average.toFixed(1),
            eventLoop: state.history.eventLoop.average.toFixed(1),
        }),

        /**
         * Máximos
         */
        maxValues: state => ({
            cpu: state.history.cpu.max.toFixed(2),
            memory: state.history.memory.max.toFixed(1),
            heap: state.history.heap.max.toFixed(1),
            eventLoop: state.history.eventLoop.max.toFixed(0),
        }),

        /**
         * Status de saúde baseado nas métricas
         */
        healthStatus: state => {
            const heap = state.current.heap.usage_percent;
            const memory = state.current.memory.usage_percent;
            const eventLoop = state.current.event_loop.lag_ms;

            if (heap > 90 || memory > 95 || eventLoop > 100) {
                return 'critical';
            }
            if (heap > 70 || memory > 80 || eventLoop > 50) {
                return 'warning';
            }
            return 'healthy';
        },
    },

    actions: {
        /**
         * Carrega métricas atuais da API
         */
        async fetchCurrent() {
            try {
                const response = await http.get('/api/dashboard/telemetry/current');
                const metrics = response.data.metrics;

                if (metrics) {
                    this.updateMetrics(metrics);
                }
            } catch (error) {
                this.error = formatHttpError(error).message;
                console.error('[TelemetryStore] Erro ao carregar métricas:', error);
            }
        },

        /**
         * Carrega histórico completo da API
         */
        async fetchHistory() {
            try {
                const response = await http.get('/api/dashboard/telemetry/history');
                const data = response.data;

                // Popula buffers com histórico do servidor
                if (data.cpu?.history) {
                    this.history.cpu.clear();
                    data.cpu.history.forEach(item => {
                        this.history.cpu.push(item.value, item.timestamp);
                    });
                }

                if (data.memory?.history) {
                    this.history.memory.clear();
                    data.memory.history.forEach(item => {
                        this.history.memory.push(item.value, item.timestamp);
                    });
                }

                if (data.heap?.history) {
                    this.history.heap.clear();
                    data.heap.history.forEach(item => {
                        this.history.heap.push(item.value, item.timestamp);
                    });
                }

                if (data.event_loop?.history) {
                    this.history.eventLoop.clear();
                    data.event_loop.history.forEach(item => {
                        this.history.eventLoop.push(item.value, item.timestamp);
                    });
                }

                if (data.queue?.history) {
                    this.history.queueSize.clear();
                    data.queue.history.forEach(item => {
                        this.history.queueSize.push(item.value, item.timestamp);
                    });
                }
            } catch (error) {
                this.error = formatHttpError(error).message;
                console.error('[TelemetryStore] Erro ao carregar histórico:', error);
            }
        },

        /**
         * Atualiza métricas (usado por Socket.io handler)
         */
        updateMetrics(metrics) {
            this.current = {
                ...this.current,
                ...metrics,
            };

            // Adiciona aos buffers locais
            this.history.cpu.push(metrics.cpu?.usage_percent || 0, metrics.timestamp);
            this.history.memory.push(metrics.memory?.usage_percent || 0, metrics.timestamp);
            this.history.heap.push(metrics.heap?.usage_percent || 0, metrics.timestamp);
            this.history.eventLoop.push(metrics.event_loop?.lag_ms || 0, metrics.timestamp);
            this.history.queueSize.push(metrics.queue?.size || 0, metrics.timestamp);

            this.lastReceived = Date.now();
            this.receiving = true;
            this.samplesReceived++;
        },

        /**
         * Handler para evento Socket.io telemetry:metrics
         */
        handleTelemetryMetrics(data) {
            this.updateMetrics(data);
        },

        /**
         * Define status de conexão
         */
        setConnected(connected) {
            this.connected = connected;
            if (!connected) {
                this.receiving = false;
            }
        },

        /**
         * Limpa histórico
         */
        clearHistory() {
            this.history.cpu.clear();
            this.history.memory.clear();
            this.history.heap.clear();
            this.history.eventLoop.clear();
            this.history.queueSize.clear();
            this.samplesReceived = 0;
        },

        /**
         * Limpa erro
         */
        clearError() {
            this.error = null;
        },
    },
});
