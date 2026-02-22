<template>
    <div class="performance-metrics">
        <!-- Header -->
        <div class="page-header">
            <div class="header-left">
                <h1>Performance Metrics</h1>
                <span class="status-badge" :class="connectionStatus">
                    {{ connectionLabel }}
                </span>
            </div>
            <div class="header-actions">
                <button class="btn btn-secondary" @click="refreshData" :disabled="loading">
                    {{ loading ? 'Carregando...' : 'Atualizar' }}
                </button>
                <select v-model="timeWindow" class="select-window">
                    <option value="30">Últimos 30s</option>
                    <option value="60">Último 1min</option>
                    <option value="120">Últimos 2min</option>
                </select>
            </div>
        </div>

        <!-- Gauge Grid -->
        <div class="gauges-grid">
            <div class="gauge-card">
                <GaugeChart
                    :value="telemetry.cpuLoad"
                    :max="100"
                    label="CPU Usage"
                    unit="%"
                    :warningThreshold="70"
                    :criticalThreshold="90"
                />
            </div>
            <div class="gauge-card">
                <GaugeChart
                    :value="telemetry.memoryUsage"
                    :max="100"
                    label="Memory"
                    unit="%"
                    :warningThreshold="80"
                    :criticalThreshold="95"
                />
            </div>
            <div class="gauge-card">
                <GaugeChart
                    :value="telemetry.heapUsage"
                    :max="100"
                    label="Heap"
                    unit="%"
                    :warningThreshold="70"
                    :criticalThreshold="90"
                />
            </div>
            <div class="gauge-card">
                <GaugeChart
                    :value="telemetry.eventLoopLag"
                    :max="200"
                    label="Event Loop Lag"
                    unit="ms"
                    :warningThreshold="25"
                    :criticalThreshold="50"
                />
            </div>
        </div>

        <!-- Charts Grid -->
        <div class="charts-grid">
            <div class="chart-card">
                <div class="chart-header">
                    <h3>CPU Usage</h3>
                    <span class="chart-stat"
                        >Avg: {{ telemetry.averages.cpu }}% | Max: {{ telemetry.maxValues.cpu }}%</span
                    >
                </div>
                <LineChart
                    :data="cpuChartData"
                    :labels="timeLabels"
                    label="CPU %"
                    color="#3498db"
                    fillColor="rgba(52, 152, 219, 0.1)"
                    :yMin="0"
                    :yMax="100"
                    :tension="0.3"
                />
            </div>
            <div class="chart-card">
                <div class="chart-header">
                    <h3>Memory Usage</h3>
                    <span class="chart-stat"
                        >Avg: {{ telemetry.averages.memory }}% | Max: {{ telemetry.maxValues.memory }}%</span
                    >
                </div>
                <LineChart
                    :data="memoryChartData"
                    :labels="timeLabels"
                    label="Memory %"
                    color="#27ae60"
                    fillColor="rgba(39, 174, 96, 0.1)"
                    :yMin="0"
                    :yMax="100"
                    :tension="0.3"
                />
            </div>
            <div class="chart-card">
                <div class="chart-header">
                    <h3>Heap Usage</h3>
                    <span class="chart-stat"
                        >Avg: {{ telemetry.averages.heap }}% | Max: {{ telemetry.maxValues.heap }}%</span
                    >
                </div>
                <LineChart
                    :data="heapChartData"
                    :labels="timeLabels"
                    label="Heap %"
                    color="#9b59b6"
                    fillColor="rgba(155, 89, 182, 0.1)"
                    :yMin="0"
                    :yMax="100"
                    :tension="0.3"
                />
            </div>
            <div class="chart-card">
                <div class="chart-header">
                    <h3>Event Loop Lag</h3>
                    <span class="chart-stat"
                        >Avg: {{ telemetry.averages.eventLoop }}ms | Max: {{ telemetry.maxValues.eventLoop }}ms</span
                    >
                </div>
                <LineChart
                    :data="eventLoopChartData"
                    :labels="timeLabels"
                    label="Lag (ms)"
                    color="#e67e22"
                    fillColor="rgba(230, 126, 34, 0.1)"
                    :yMin="0"
                    :yMax="200"
                    :tension="0.2"
                />
            </div>
        </div>

        <!-- Stats & Distribution Row -->
        <div class="stats-row">
            <!-- Task Status Distribution -->
            <div class="stats-card">
                <h3>Task Distribution</h3>
                <BarChart
                    :data="taskDistributionData"
                    :labels="taskDistributionLabels"
                    label="Tasks"
                    :colors="taskDistributionColors"
                    :showLegend="false"
                />
            </div>

            <!-- Task Status Counts -->
            <div class="stats-card">
                <h3>Task Statistics</h3>
                <div class="stat-list">
                    <div class="stat-item" v-for="stat in taskStats" :key="stat.key">
                        <span class="stat-icon">{{ stat.icon }}</span>
                        <span class="stat-label">{{ stat.label }}</span>
                        <span class="stat-value" :class="'stat-' + stat.key">{{ stat.value }}</span>
                    </div>
                </div>
            </div>

            <!-- System Info -->
            <div class="stats-card">
                <h3>System Info</h3>
                <table class="info-table">
                    <tbody>
                        <tr>
                            <td class="info-label">Samples Received</td>
                            <td class="info-value">{{ telemetry.samplesReceived }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">Last Update</td>
                            <td class="info-value">{{ lastUpdateLabel }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">Load Avg (1m)</td>
                            <td class="info-value">{{ telemetry.current.cpu.load_1min ?? '-' }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">CPU Cores</td>
                            <td class="info-value">{{ telemetry.current.cpu.cores || '-' }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">Total Memory</td>
                            <td class="info-value">{{ formatMB(telemetry.current.memory.total_mb) }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">Heap Limit</td>
                            <td class="info-value">{{ formatMB(telemetry.current.heap.limit_mb) }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">NERV Latency</td>
                            <td class="info-value">{{ telemetry.current.nerv.latency_ms }}ms</td>
                        </tr>
                        <tr>
                            <td class="info-label">NERV Throughput</td>
                            <td class="info-value">{{ telemetry.current.nerv.throughput }} ev/s</td>
                        </tr>
                        <tr>
                            <td class="info-label">Queue Size</td>
                            <td class="info-value">{{ telemetry.current.queue.size }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useTelemetryStore } from '@/stores/telemetry';
import { useTaskStore } from '@/stores/tasks';
import { useRealtime } from '@/composables/useRealtime';
import { LineChart, GaugeChart, BarChart } from '@/components/charts/index';

export default {
    name: 'PerformanceMetrics',

    components: {
        LineChart,
        GaugeChart,
        BarChart,
    },

    setup() {
        const telemetry = useTelemetryStore();
        const tasks = useTaskStore();
        const loading = ref(false);

        // Time window for chart display (seconds)
        const timeWindow = ref(60);

        // Activate real-time telemetry
        useRealtime();

        // Computed chart data arrays (values only)
        const cpuChartData = computed(() => {
            const history = telemetry.cpuHistory;
            return history.slice(-timeWindow.value).map(item => item.value);
        });

        const memoryChartData = computed(() => {
            const history = telemetry.memoryHistory;
            return history.slice(-timeWindow.value).map(item => item.value);
        });

        const heapChartData = computed(() => {
            const history = telemetry.heapHistory;
            return history.slice(-timeWindow.value).map(item => item.value);
        });

        const eventLoopChartData = computed(() => {
            const history = telemetry.history.eventLoop.getLast(120);
            return history.slice(-timeWindow.value).map(item => item.value);
        });

        // Time labels from timestamps
        const timeLabels = computed(() => {
            const history = telemetry.cpuHistory;
            const slice = history.slice(-timeWindow.value);
            if (slice.length === 0) return [];

            const now = Date.now();
            return slice.map(item => {
                const diff = Math.round((now - item.timestamp) / 1000);
                if (diff <= 0) return 'Agora';
                if (diff < 60) return `-${diff}s`;
                return `-${Math.floor(diff / 60)}m`;
            });
        });

        // Task distribution for bar chart
        const taskDistributionLabels = computed(() => ['Running', 'Pending', 'Done', 'Failed']);

        const taskDistributionData = computed(() => {
            const counts = tasks.statusCounts || {};
            return [counts.RUNNING || 0, counts.PENDING || 0, counts.DONE || 0, counts.FAILED || 0];
        });

        const taskDistributionColors = ['#f39c12', '#3498db', '#27ae60', '#e74c3c'];

        // Task stats list
        const taskStats = computed(() => {
            const counts = tasks.statusCounts || {};
            return [
                { key: 'running', icon: '▶', label: 'Running', value: counts.RUNNING || 0 },
                { key: 'pending', icon: '⏳', label: 'Pending', value: counts.PENDING || 0 },
                { key: 'done', icon: '✓', label: 'Done', value: counts.DONE || 0 },
                { key: 'failed', icon: '✗', label: 'Failed', value: counts.FAILED || 0 },
                { key: 'queue', icon: '📋', label: 'Queue Size', value: telemetry.queueSize },
            ];
        });

        // Connection status
        const connectionStatus = computed(() => {
            if (telemetry.receiving) return 'connected';
            if (telemetry.connected) return 'idle';
            return 'disconnected';
        });

        const connectionLabel = computed(() => {
            if (telemetry.receiving) return 'Live';
            if (telemetry.connected) return 'Connected';
            return 'Disconnected';
        });

        // Last update time
        const lastUpdateLabel = computed(() => {
            if (!telemetry.lastReceived) return 'Nunca';
            const diff = Math.round((Date.now() - telemetry.lastReceived) / 1000);
            if (diff < 2) return 'Há 1s';
            if (diff < 60) return `Há ${diff}s`;
            return `Há ${Math.floor(diff / 60)}m`;
        });

        // Format bytes to MB string
        function formatMB(mb) {
            if (!mb) return '-';
            if (mb > 1024) return `${(mb / 1024).toFixed(1)} GB`;
            return `${mb.toFixed(0)} MB`;
        }

        // Refresh data from API
        async function refreshData() {
            loading.value = true;
            try {
                await telemetry.fetchCurrent();
                await telemetry.fetchHistory();
                await tasks.fetchTasks();
            } finally {
                loading.value = false;
            }
        }

        // Initial load
        onMounted(() => {
            refreshData();
        });

        return {
            telemetry,
            loading,
            timeWindow,
            cpuChartData,
            memoryChartData,
            heapChartData,
            eventLoopChartData,
            timeLabels,
            taskDistributionLabels,
            taskDistributionData,
            taskDistributionColors,
            taskStats,
            connectionStatus,
            connectionLabel,
            lastUpdateLabel,
            formatMB,
            refreshData,
        };
    },
};
</script>

<style scoped>
.performance-metrics {
    padding: 20px;
    max-width: 1600px;
    margin: 0 auto;
}

/* Header */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.page-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
}

.status-badge {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
}

.status-badge.connected {
    background: #dcfce7;
    color: #166534;
}

.status-badge.idle {
    background: #fef9c3;
    color: #854d0e;
}

.status-badge.disconnected {
    background: #fee2e2;
    color: #991b1b;
}

.header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.btn {
    padding: 6px 14px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #fff;
    color: #475569;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
}

.btn:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #cbd5e1;
}

.btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.select-window {
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 0.85rem;
    color: #475569;
    background: #fff;
}

/* Gauge Grid */
.gauges-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;
}

.gauge-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Charts Grid */
.charts-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    margin-bottom: 24px;
}

.chart-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 20px;
}

.chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.chart-header h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
}

.chart-stat {
    font-size: 0.75rem;
    color: #64748b;
}

/* Stats Row */
.stats-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
}

.stats-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 20px;
}

.stats-card h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 16px 0;
}

/* Stat List */
.stat-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 10px;
}

.stat-icon {
    font-size: 1rem;
    width: 24px;
    text-align: center;
}

.stat-label {
    flex: 1;
    font-size: 0.85rem;
    color: #64748b;
}

.stat-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: #1e293b;
}

.stat-running {
    color: #f39c12;
}
.stat-pending {
    color: #3498db;
}
.stat-done {
    color: #27ae60;
}
.stat-failed {
    color: #e74c3c;
}
.stat-queue {
    color: #64748b;
}

/* Info Table */
.info-table {
    width: 100%;
    border-collapse: collapse;
}

.info-table tr {
    border-bottom: 1px solid #f1f5f9;
}

.info-table tr:last-child {
    border-bottom: none;
}

.info-label {
    padding: 6px 0;
    font-size: 0.8rem;
    color: #64748b;
}

.info-value {
    padding: 6px 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: #1e293b;
    text-align: right;
}

/* Responsive */
@media (max-width: 1200px) {
    .gauges-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 900px) {
    .charts-grid {
        grid-template-columns: 1fr;
    }

    .stats-row {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 600px) {
    .gauges-grid {
        grid-template-columns: repeat(2, 1fr);
    }

    .page-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }
}
</style>
