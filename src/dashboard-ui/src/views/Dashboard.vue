<template>
    <div class="dashboard">
        <div class="header">
            <h1>Mission Control Dashboard</h1>
            <div class="connection-status" :class="{ connected: isConnected }">
                <span class="dot"></span>
                {{ isConnected ? 'Live' : 'Disconnected' }}
            </div>
        </div>

        <!-- Metrics Grid -->
        <div class="metrics-grid">
            <div class="metric-card" :class="getHealthClass(telemetry.heapUsage)">
                <div class="metric-icon">💾</div>
                <div class="metric-content">
                    <div class="metric-value">{{ telemetry.heapUsage.toFixed(1) }}%</div>
                    <div class="metric-label">Heap Usage</div>
                </div>
            </div>

            <div class="metric-card" :class="getHealthClass(telemetry.memoryUsage)">
                <div class="metric-icon">🧠</div>
                <div class="metric-content">
                    <div class="metric-value">{{ telemetry.memoryUsage.toFixed(1) }}%</div>
                    <div class="metric-label">Memory</div>
                </div>
            </div>

            <div class="metric-card">
                <div class="metric-icon">⚡</div>
                <div class="metric-content">
                    <div class="metric-value">{{ telemetry.cpuLoad.toFixed(1) }}%</div>
                    <div class="metric-label">CPU Usage</div>
                </div>
            </div>

            <div class="metric-card" :class="getEventLoopClass(telemetry.eventLoopLag)">
                <div class="metric-icon">🔄</div>
                <div class="metric-content">
                    <div class="metric-value">{{ telemetry.eventLoopLag }}ms</div>
                    <div class="metric-label">Event Loop Lag</div>
                </div>
            </div>
        </div>

        <!-- Task Summary -->
        <div class="section">
            <h2>Tasks Overview</h2>
            <div class="summary-grid">
                <div class="summary-card running">
                    <div class="summary-count">{{ taskCounts.running }}</div>
                    <div class="summary-label">Running</div>
                </div>
                <div class="summary-card pending">
                    <div class="summary-count">{{ taskCounts.pending }}</div>
                    <div class="summary-label">Pending</div>
                </div>
                <div class="summary-card done">
                    <div class="summary-count">{{ taskCounts.done }}</div>
                    <div class="summary-label">Done</div>
                </div>
                <div class="summary-card failed">
                    <div class="summary-count">{{ taskCounts.failed }}</div>
                    <div class="summary-label">Failed</div>
                </div>
            </div>
        </div>

        <!-- System Health -->
        <div class="section">
            <h2>System Health</h2>
            <div class="health-grid">
                <div
                    v-for="component in components"
                    :key="component.name"
                    class="health-card"
                    :class="component.status"
                >
                    <div class="health-name">{{ component.name }}</div>
                    <div class="health-status">{{ component.status }}</div>
                    <div class="health-message">{{ component.message }}</div>
                </div>
            </div>
        </div>

        <!-- Alerts -->
        <div v-if="alerts.length > 0" class="section alerts-section">
            <h2>Active Alerts ({{ alerts.length }})</h2>
            <div class="alerts-list">
                <div v-for="alert in alerts" :key="alert.id" class="alert-item" :class="alert.severity">
                    <span class="alert-icon">{{ alert.severity === 'critical' ? '🚨' : '⚠️' }}</span>
                    <span class="alert-message">{{ alert.message }}</span>
                    <span class="alert-time">{{ formatTime(alert.triggered_at) }}</span>
                </div>
            </div>
        </div>

        <!-- Quick Stats -->
        <div class="section">
            <h2>System Info</h2>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Uptime</span>
                    <span class="info-value">{{ system.uptimeFormatted }}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Samples</span>
                    <span class="info-value">{{ telemetryStore.samplesReceived }}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Queue Size</span>
                    <span class="info-value">{{ telemetry.queueSize }}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Total Tasks</span>
                    <span class="info-value">{{ tasks.length }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { useRealtime } from '@/composables/useRealtime';
import { useSystemStore } from '@/stores/system';
import { useTaskStore } from '@/stores/tasks';
import { useTelemetryStore } from '@/stores/telemetry';
import { computed, onMounted } from 'vue';

export default {
    name: 'Dashboard',
    setup() {
        // Real-time integration
        const { isConnected } = useRealtime();

        // Stores
        const taskStore = useTaskStore();
        const telemetryStore = useTelemetryStore();
        const systemStore = useSystemStore();

        // Computed
        const telemetry = computed(() => ({
            heapUsage: telemetryStore.heapUsage,
            memoryUsage: telemetryStore.memoryUsage,
            cpuLoad: telemetryStore.cpuLoad,
            eventLoopLag: telemetryStore.eventLoopLag,
            queueSize: telemetryStore.queueSize,
        }));

        const taskCounts = computed(() => {
            const c = taskStore.statusCounts || {};
            return {
                running: c.RUNNING || 0,
                pending: c.PENDING || 0,
                done: c.DONE || 0,
                failed: c.FAILED || 0,
                paused: c.PAUSED || 0,
            };
        });
        const tasks = computed(() => taskStore.tasks);
        const alerts = computed(() => systemStore.alerts);
        const components = computed(() => systemStore.componentsList);
        const system = computed(() => ({
            uptimeFormatted: systemStore.uptimeFormatted,
        }));

        // Methods
        const getHealthClass = (value: number) => {
            if (value > 90) return 'critical';
            if (value > 70) return 'warning';
            return 'healthy';
        };

        const getEventLoopClass = (value: number) => {
            if (value > 100) return 'critical';
            if (value > 50) return 'warning';
            return 'healthy';
        };

        const formatTime = (timestamp: string | number | Date | null | undefined) => {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            return date.toLocaleTimeString();
        };

        // Load initial data
        onMounted(async () => {
            await systemStore.fetchSystemInfo();
        });

        return {
            isConnected,
            telemetry,
            taskCounts,
            tasks,
            alerts,
            components,
            system,
            telemetryStore,
            getHealthClass,
            getEventLoopClass,
            formatTime,
        };
    },
};
</script>

<style scoped>
.dashboard {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.header h1 {
    margin: 0;
    color: #2c3e50;
    font-size: 1.8rem;
}

.connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 20px;
    background: #fee2e2;
    color: #dc2626;
    font-size: 0.9rem;
    font-weight: 500;
}

.connection-status.connected {
    background: #dcfce7;
    color: #16a34a;
}

.connection-status .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 2s infinite;
}

@keyframes pulse {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

/* Metrics Grid */
.metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

.metric-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    border-left: 4px solid #3498db;
}

.metric-card.healthy {
    border-left-color: #22c55e;
}

.metric-card.warning {
    border-left-color: #f59e0b;
    background: #fffbeb;
}

.metric-card.critical {
    border-left-color: #ef4444;
    background: #fef2f2;
}

.metric-icon {
    font-size: 2rem;
}

.metric-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #1e293b;
}

.metric-label {
    font-size: 0.85rem;
    color: #64748b;
}

/* Section */
.section {
    margin-bottom: 24px;
}

.section h2 {
    margin: 0 0 16px;
    color: #334155;
    font-size: 1.2rem;
}

/* Summary Grid */
.summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
}

.summary-card {
    padding: 20px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    text-align: center;
}

.summary-card.running {
    border-top: 4px solid #f59e0b;
}

.summary-card.pending {
    border-top: 4px solid #94a3b8;
}

.summary-card.done {
    border-top: 4px solid #22c55e;
}

.summary-card.failed {
    border-top: 4px solid #ef4444;
}

.summary-count {
    font-size: 2rem;
    font-weight: 700;
    color: #1e293b;
}

.summary-label {
    font-size: 0.9rem;
    color: #64748b;
    margin-top: 4px;
}

/* Health Grid */
.health-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
}

.health-card {
    padding: 16px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.health-card.healthy {
    border-left: 4px solid #22c55e;
}

.health-card.warning {
    border-left: 4px solid #f59e0b;
}

.health-card.critical,
.health-card.error {
    border-left: 4px solid #ef4444;
}

.health-card.unknown,
.health-card.degraded {
    border-left: 4px solid #94a3b8;
}

.health-name {
    font-weight: 600;
    color: #1e293b;
    text-transform: capitalize;
}

.health-status {
    font-size: 0.85rem;
    color: #64748b;
    margin-top: 4px;
}

.health-message {
    font-size: 0.8rem;
    color: #94a3b8;
    margin-top: 4px;
}

/* Alerts */
.alerts-section {
    background: #fef2f2;
    padding: 16px;
    border-radius: 12px;
}

.alerts-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.alert-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: white;
    border-radius: 8px;
}

.alert-item.critical {
    border-left: 4px solid #ef4444;
}

.alert-item.warning {
    border-left: 4px solid #f59e0b;
}

.alert-icon {
    font-size: 1.2rem;
}

.alert-message {
    flex: 1;
    color: #1e293b;
}

.alert-time {
    font-size: 0.8rem;
    color: #94a3b8;
}

/* Info Grid */
.info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
}

.info-item {
    display: flex;
    flex-direction: column;
    padding: 16px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.info-label {
    font-size: 0.85rem;
    color: #64748b;
}

.info-value {
    font-size: 1.1rem;
    font-weight: 600;
    color: #1e293b;
    margin-top: 4px;
}
</style>
