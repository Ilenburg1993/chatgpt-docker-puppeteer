<template>
    <div class="system-health">
        <!-- Header -->
        <div class="page-header">
            <div class="header-left">
                <h1>System Health</h1>
                <span class="overall-badge" :class="system.overallStatus">
                    {{ overallLabel }}
                </span>
            </div>
            <div class="header-actions">
                <button class="btn" @click="refreshAll" :disabled="system.loading">
                    {{ system.loading ? 'Carregando...' : 'Atualizar' }}
                </button>
            </div>
        </div>

        <!-- Alert Panel -->
        <div class="alert-panel" v-if="system.alertCount > 0">
            <div class="alert-header">
                <span class="alert-icon">⚠</span>
                <span class="alert-title">{{ system.alertCount }} Alerta{{ system.alertCount > 1 ? 's' : '' }} Ativo{{ system.alertCount > 1 ? 's' : '' }}</span>
            </div>
            <div class="alert-list">
                <div
                    v-for="(alert, index) in system.alerts"
                    :key="index"
                    class="alert-item"
                    :class="'alert-' + alert.severity"
                >
                    <span class="alert-severity-icon">{{ alert.severity === 'critical' ? '🔴' : '🟡' }}</span>
                    <div class="alert-content">
                        <span class="alert-name">{{ alert.name }}</span>
                        <span class="alert-message">{{ alert.message }}</span>
                    </div>
                    <span class="alert-time">{{ formatTime(alert.triggered_at) }}</span>
                </div>
            </div>
        </div>

        <!-- No Alerts -->
        <div class="no-alerts" v-else>
            <span class="no-alerts-icon">✓</span>
            <span>Nenhum alerta ativo</span>
        </div>

        <!-- Component Health Cards -->
        <div class="health-grid">
            <div
                v-for="component in system.componentsList"
                :key="component.name"
                class="health-card"
                :class="'card-' + component.status"
            >
                <div class="card-header">
                    <span class="status-led" :class="component.status"></span>
                    <h3>{{ formatComponentName(component.name) }}</h3>
                    <span class="status-text" :class="component.status">
                        {{ component.status }}
                    </span>
                </div>

                <div class="card-body">
                    <p class="card-message" v-if="component.message">
                        {{ component.message }}
                    </p>

                    <!-- Component-specific metrics -->
                    <div class="card-metrics" v-if="component.metrics">
                        <div
                            v-for="(metric, key) in component.metrics"
                            :key="key"
                            class="metric-row"
                        >
                            <span class="metric-label">{{ formatMetricLabel(key) }}</span>
                            <span class="metric-value">{{ formatMetricValue(metric) }}</span>
                        </div>
                    </div>

                    <!-- Fallback: show uptime if available -->
                    <div class="card-metrics" v-else-if="component.uptime">
                        <div class="metric-row">
                            <span class="metric-label">Uptime</span>
                            <span class="metric-value">{{ formatUptime(component.uptime) }}</span>
                        </div>
                    </div>

                    <!-- Status timestamp -->
                    <div class="card-footer" v-if="component.checked_at">
                        <span class="footer-time">Verificado: {{ formatTime(component.checked_at) }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- System Information -->
        <div class="info-section">
            <div class="info-card">
                <h3>Informações do Sistema</h3>
                <table class="info-table">
                    <tbody>
                        <tr v-if="system.systemInfo.platform">
                            <td class="info-label">Platform</td>
                            <td class="info-value">{{ system.systemInfo.platform }}</td>
                        </tr>
                        <tr v-if="system.systemInfo.arch">
                            <td class="info-label">Architecture</td>
                            <td class="info-value">{{ system.systemInfo.arch }}</td>
                        </tr>
                        <tr v-if="system.systemInfo.node_version">
                            <td class="info-label">Node.js</td>
                            <td class="info-value">{{ system.systemInfo.node_version }}</td>
                        </tr>
                        <tr v-if="system.systemInfo.pid">
                            <td class="info-label">PID</td>
                            <td class="info-value">{{ system.systemInfo.pid }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">Uptime</td>
                            <td class="info-value">{{ system.uptimeFormatted }}</td>
                        </tr>
                        <tr>
                            <td class="info-label">Última Atualização</td>
                            <td class="info-value">{{ lastUpdateLabel }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="info-card">
                <h3>Resumo de Saúde</h3>
                <div class="health-summary">
                    <div class="summary-item">
                        <span class="summary-count healthy-count">{{ healthyCounts.healthy }}</span>
                        <span class="summary-label">Saudáveis</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-count warning-count">{{ healthyCounts.warning }}</span>
                        <span class="summary-label">Avisos</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-count critical-count">{{ healthyCounts.critical }}</span>
                        <span class="summary-label">Críticos</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-count unknown-count">{{ healthyCounts.unknown }}</span>
                        <span class="summary-label">Desconhecidos</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { computed, onMounted } from 'vue';
import { useSystemStore } from '@/stores/system';
import { useRealtime } from '@/composables/useRealtime';

export default {
    name: 'SystemHealth',

    setup() {
        const system = useSystemStore();

        // Activate real-time updates
        useRealtime();

        // Overall status label
        const overallLabel = computed(() => {
            const map = {
                healthy: 'Saudável',
                warning: 'Atenção',
                critical: 'Crítico',
                error: 'Erro',
                unknown: 'Desconhecido'
            };
            return map[system.overallStatus] || 'Desconhecido';
        });

        // Last update label
        const lastUpdateLabel = computed(() => {
            if (!system.lastUpdate) return 'Nunca';
            const diff = Math.round((Date.now() - system.lastUpdate) / 1000);
            if (diff < 2) return 'Há 1s';
            if (diff < 60) return `Há ${diff}s`;
            return `Há ${Math.floor(diff / 60)}m`;
        });

        // Health counts summary
        const healthyCounts = computed(() => {
            const counts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
            system.componentsList.forEach(comp => {
                const status = comp.status;
                if (counts[status] !== undefined) {
                    counts[status]++;
                } else {
                    counts.unknown++;
                }
            });
            return counts;
        });

        // Format component name
        function formatComponentName(name) {
            const map = {
                api: 'API Server',
                queue: 'Task Queue',
                memory: 'Memory',
                kernel: 'Kernel Engine',
                nerv: 'NERV Bus',
                driver: 'Driver',
                browser_pool: 'Browser Pool'
            };
            return map[name] || name.charAt(0).toUpperCase() + name.slice(1);
        }

        // Format metric label
        function formatMetricLabel(key) {
            return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }

        // Format metric value
        function formatMetricValue(value) {
            if (typeof value === 'number') {
                if (value > 1000) return `${(value / 1000).toFixed(1)}k`;
                if (Number.isFinite(value)) return value.toFixed(1);
            }
            return String(value);
        }

        // Format uptime seconds
        function formatUptime(seconds) {
            if (!seconds) return '-';
            const s = Math.floor(seconds);
            const days = Math.floor(s / 86400);
            const hours = Math.floor((s % 86400) / 3600);
            const mins = Math.floor((s % 3600) / 60);
            if (days > 0) return `${days}d ${hours}h ${mins}m`;
            if (hours > 0) return `${hours}h ${mins}m`;
            return `${mins}m`;
        }

        // Format timestamp
        function formatTime(timestamp) {
            if (!timestamp) return '-';
            const date = new Date(timestamp);
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // Refresh all data
        async function refreshAll() {
            await system.fetchHealth();
            await system.fetchSystemInfo();
        }

        // Initial load
        onMounted(() => {
            refreshAll();
        });

        return {
            system,
            overallLabel,
            lastUpdateLabel,
            healthyCounts,
            formatComponentName,
            formatMetricLabel,
            formatMetricValue,
            formatUptime,
            formatTime,
            refreshAll
        };
    }
};
</script>

<style scoped>
.system-health {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
}

/* Header */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
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

.overall-badge {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
}

.overall-badge.healthy { background: #dcfce7; color: #166534; }
.overall-badge.warning { background: #fef9c3; color: #854d0e; }
.overall-badge.critical { background: #fee2e2; color: #991b1b; }
.overall-badge.error { background: #fee2e2; color: #991b1b; }
.overall-badge.unknown { background: #f1f5f9; color: #64748b; }

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

/* Alert Panel */
.alert-panel {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    margin-bottom: 20px;
    overflow: hidden;
}

.alert-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: #fef3c7;
    border-bottom: 1px solid #fde68a;
}

.alert-icon {
    font-size: 1.1rem;
}

.alert-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #92400e;
}

.alert-list {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.alert-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
}

.alert-item.alert-critical {
    background: #fef2f2;
    border: 1px solid #fecaca;
}

.alert-item.alert-warning {
    background: #fffbeb;
    border: 1px solid #fde68a;
}

.alert-severity-icon {
    font-size: 0.85rem;
    flex-shrink: 0;
}

.alert-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.alert-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #1e293b;
}

.alert-message {
    font-size: 0.75rem;
    color: #64748b;
}

.alert-time {
    font-size: 0.7rem;
    color: #94a3b8;
    flex-shrink: 0;
}

/* No Alerts */
.no-alerts {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 0.85rem;
    color: #166534;
}

.no-alerts-icon {
    font-weight: 700;
}

/* Health Grid */
.health-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
}

.health-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    transition: border-color 0.2s;
}

.health-card.card-healthy { border-color: #bbf7d0; }
.health-card.card-warning { border-color: #fde68a; }
.health-card.card-critical { border-color: #fecaca; }
.health-card.card-error { border-color: #fecaca; }

.card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid #f1f5f9;
}

.status-led {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.status-led.healthy { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.4); }
.status-led.warning { background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
.status-led.critical { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); }
.status-led.error { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); }
.status-led.unknown { background: #94a3b8; }

.card-header h3 {
    flex: 1;
    font-size: 0.9rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
}

.status-text {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
}

.status-text.healthy { color: #166534; }
.status-text.warning { color: #854d0e; }
.status-text.critical { color: #991b1b; }
.status-text.error { color: #991b1b; }
.status-text.unknown { color: #64748b; }

.card-body {
    padding: 12px 16px;
}

.card-message {
    font-size: 0.8rem;
    color: #64748b;
    margin: 0 0 10px 0;
    font-style: italic;
}

.card-metrics {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.metric-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.metric-label {
    font-size: 0.75rem;
    color: #64748b;
}

.metric-value {
    font-size: 0.75rem;
    font-weight: 600;
    color: #1e293b;
}

.card-footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #f1f5f9;
}

.footer-time {
    font-size: 0.7rem;
    color: #94a3b8;
}

/* Info Section */
.info-section {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
}

.info-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 20px;
}

.info-card h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0 0 16px 0;
}

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

/* Health Summary */
.health-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
}

.summary-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
}

.summary-count {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;
}

.healthy-count { color: #22c55e; }
.warning-count { color: #f59e0b; }
.critical-count { color: #ef4444; }
.unknown-count { color: #94a3b8; }

.summary-label {
    font-size: 0.7rem;
    color: #64748b;
}

/* Responsive */
@media (max-width: 900px) {
    .info-section {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 600px) {
    .health-summary {
        grid-template-columns: repeat(2, 1fr);
    }
}
</style>
