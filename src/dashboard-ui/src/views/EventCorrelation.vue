<template>
    <div class="event-correlation">
        <!-- Header -->
        <div class="page-header">
            <div class="header-left">
                <h1>Event Correlation</h1>
                <span class="event-count">{{ events.length }} evento{{ events.length !== 1 ? 's' : '' }}</span>
            </div>
            <div class="header-actions">
                <button class="btn" @click="clearEvents">Limpar</button>
                <button class="btn" @click="loadSampleEvents">Carregar Exemplos</button>
            </div>
        </div>

        <!-- Filters -->
        <div class="filters-bar">
            <div class="filter-group">
                <label>Tipo</label>
                <select v-model="filterType" class="filter-select">
                    <option value="">Todos</option>
                    <option value="TASK_STARTED">Task Started</option>
                    <option value="TASK_COMPLETED">Task Completed</option>
                    <option value="TASK_FAILED">Task Failed</option>
                    <option value="TASK_PROGRESS">Task Progress</option>
                    <option value="DRIVER_EXECUTE">Driver Execute</option>
                    <option value="DRIVER_COMPLETED">Driver Completed</option>
                    <option value="KERNEL_LOOP">Kernel Loop</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Correlation ID</label>
                <input
                    v-model="filterCorrelation"
                    type="text"
                    class="filter-input"
                    placeholder="Filtrar por correlation..."
                />
            </div>
            <div class="filter-group">
                <label>Período</label>
                <select v-model="timePeriod" class="filter-select">
                    <option value="60000">Último 1min</option>
                    <option value="300000">Últimos 5min</option>
                    <option value="900000">Últimos 15min</option>
                    <option value="3600000">Última hora</option>
                    <option value="0">Todos</option>
                </select>
            </div>
        </div>

        <!-- Timeline Container -->
        <div class="timeline-section">
            <div ref="timelineContainer" class="timeline-container">
                <!-- Vis-Timeline will be mounted here -->
                <div v-if="filteredEvents.length === 0" class="timeline-empty">
                    <p>Nenhum evento disponível</p>
                    <p class="timeline-hint">Eventos NERV aparecerão aqui em tempo real</p>
                </div>
            </div>
        </div>

        <!-- Event Table -->
        <div class="event-table-section">
            <h3>Eventos Recentes</h3>
            <div class="table-wrapper">
                <table class="event-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Tipo</th>
                            <th>Correlation</th>
                            <th>Actor</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="event in paginatedEvents"
                            :key="event.id"
                            class="event-row"
                            :class="'event-' + getEventCategory(event.actionCode)"
                            @click="selectEvent(event)"
                        >
                            <td class="col-time">{{ formatTime(event.timestamp) }}</td>
                            <td class="col-type">
                                <span class="type-badge" :class="'badge-' + getEventCategory(event.actionCode)">
                                    {{ event.actionCode }}
                                </span>
                            </td>
                            <td class="col-correlation">{{ truncate(event.correlationId, 12) }}</td>
                            <td class="col-actor">{{ event.actor || '-' }}</td>
                            <td class="col-details">{{ truncate(JSON.stringify(event.payload), 60) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Pagination -->
            <div class="pagination" v-if="filteredEvents.length > pageSize">
                <button class="btn" :disabled="currentPage === 0" @click="currentPage--">Anterior</button>
                <span class="page-info">Página {{ currentPage + 1 }} / {{ totalPages }}</span>
                <button class="btn" :disabled="currentPage >= totalPages - 1" @click="currentPage++">Próxima</button>
            </div>
        </div>

        <!-- Selected Event Detail -->
        <div class="event-detail" v-if="selectedEvent">
            <div class="detail-header">
                <h3>Detalhes do Evento</h3>
                <button class="btn close-btn" @click="selectedEvent = null">✕</button>
            </div>
            <div class="detail-body">
                <div class="detail-row">
                    <span class="detail-label">Tipo</span>
                    <span class="detail-value">{{ selectedEvent.actionCode }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Timestamp</span>
                    <span class="detail-value">{{ formatFullTime(selectedEvent.timestamp) }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Correlation ID</span>
                    <span class="detail-value">{{ selectedEvent.correlationId }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Actor</span>
                    <span class="detail-value">{{ selectedEvent.actor || '-' }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Payload</span>
                    <pre class="detail-payload">{{ JSON.stringify(selectedEvent.payload, null, 2) }}</pre>
                </div>

                <!-- Correlation chain -->
                <div class="correlation-chain" v-if="correlationChain.length > 1">
                    <h4>Cadeia de Correlação</h4>
                    <div class="chain-list">
                        <div
                            v-for="(chainEvent, idx) in correlationChain"
                            :key="idx"
                            class="chain-item"
                            :class="{ 'chain-current': chainEvent.id === selectedEvent.id }"
                        >
                            <span class="chain-time">{{ formatTime(chainEvent.timestamp) }}</span>
                            <span class="chain-type">{{ chainEvent.actionCode }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRealtime } from '@/composables/useRealtime';

export default {
    name: 'EventCorrelation',

    setup() {
        const timelineContainer = ref(null);
        const events = ref([]);
        const selectedEvent = ref(null);
        const filterType = ref('');
        const filterCorrelation = ref('');
        const timePeriod = ref('300000');
        const currentPage = ref(0);
        const pageSize = 20;

        let timeline = null;

        // Activate real-time
        useRealtime();

        // Sample events for demonstration
        function loadSampleEvents() {
            const now = Date.now();
            const samples = [
                { id: 'evt-1', actionCode: 'TASK_STARTED', correlationId: 'corr-001', actor: 'kernel', timestamp: now - 5000, payload: { taskId: 'task-abc-123', strategy: 'SINGLE_SHOT' } },
                { id: 'evt-2', actionCode: 'DRIVER_EXECUTE', correlationId: 'corr-001', actor: 'driver', timestamp: now - 4500, payload: { taskId: 'task-abc-123', target: 'chatgpt', model: 'gpt-4o' } },
                { id: 'evt-3', actionCode: 'TASK_PROGRESS', correlationId: 'corr-001', actor: 'driver', timestamp: now - 3000, payload: { taskId: 'task-abc-123', progress: 50, step: 'generating' } },
                { id: 'evt-4', actionCode: 'DRIVER_COMPLETED', correlationId: 'corr-001', actor: 'driver', timestamp: now - 2000, payload: { taskId: 'task-abc-123', tokens: 1250 } },
                { id: 'evt-5', actionCode: 'TASK_COMPLETED', correlationId: 'corr-001', actor: 'kernel', timestamp: now - 1500, payload: { taskId: 'task-abc-123', duration_ms: 3500 } },
                { id: 'evt-6', actionCode: 'TASK_STARTED', correlationId: 'corr-002', actor: 'kernel', timestamp: now - 4000, payload: { taskId: 'task-def-456', strategy: 'ITERATIVE' } },
                { id: 'evt-7', actionCode: 'DRIVER_EXECUTE', correlationId: 'corr-002', actor: 'driver', timestamp: now - 3800, payload: { taskId: 'task-def-456', target: 'chatgpt', iteration: 1 } },
                { id: 'evt-8', actionCode: 'TASK_PROGRESS', correlationId: 'corr-002', actor: 'driver', timestamp: now - 2500, payload: { taskId: 'task-def-456', progress: 30, iteration: 1 } },
                { id: 'evt-9', actionCode: 'TASK_FAILED', correlationId: 'corr-002', actor: 'driver', timestamp: now - 1000, payload: { taskId: 'task-def-456', error: 'Validation failed', iteration: 1 } },
                { id: 'evt-10', actionCode: 'KERNEL_LOOP', correlationId: 'corr-sys', actor: 'kernel', timestamp: now - 500, payload: { cycle: 420, tasks_pending: 3, tasks_running: 1 } },
                { id: 'evt-11', actionCode: 'KERNEL_LOOP', correlationId: 'corr-sys', actor: 'kernel', timestamp: now - 100, payload: { cycle: 421, tasks_pending: 2, tasks_running: 2 } }
            ];

            events.value = [...samples, ...events.value];
            renderTimeline();
        }

        // Filtered events
        const filteredEvents = computed(() => {
            let result = [...events.value];
            const now = Date.now();

            // Filter by time period
            if (timePeriod.value && timePeriod.value !== '0') {
                const cutoff = now - parseInt(timePeriod.value);
                result = result.filter(e => e.timestamp >= cutoff);
            }

            // Filter by type
            if (filterType.value) {
                result = result.filter(e => e.actionCode === filterType.value);
            }

            // Filter by correlation ID
            if (filterCorrelation.value) {
                result = result.filter(e =>
                    e.correlationId && e.correlationId.includes(filterCorrelation.value)
                );
            }

            // Sort by timestamp descending
            result.sort((a, b) => b.timestamp - a.timestamp);

            return result;
        });

        // Pagination
        const totalPages = computed(() => Math.ceil(filteredEvents.value.length / pageSize));

        const paginatedEvents = computed(() => {
            const start = currentPage.value * pageSize;
            return filteredEvents.value.slice(start, start + pageSize);
        });

        // Correlation chain for selected event
        const correlationChain = computed(() => {
            if (!selectedEvent.value?.correlationId) return [];

            return events.value
                .filter(e => e.correlationId === selectedEvent.value.correlationId)
                .sort((a, b) => a.timestamp - b.timestamp);
        });

        // Reset page on filter change
        watch([filterType, filterCorrelation, timePeriod], () => {
            currentPage.value = 0;
        });

        // Render Vis-Timeline
        function renderTimeline() {
            if (!timelineContainer.value || filteredEvents.value.length === 0) return;

            // Dynamic import of vis-timeline
            import('vis-timeline').then(({ Timeline, DataSet }) => {
                // Clean up previous
                if (timeline) {
                    timeline.destroy();
                    timeline = null;
                }

                const items = new DataSet(
                    filteredEvents.value.map(event => ({
                        id: event.id,
                        content: event.actionCode,
                        start: new Date(event.timestamp),
                        title: `${event.actionCode} [${event.correlationId || 'N/A'}]`,
                        className: 'timeline-item timeline-' + getEventCategory(event.actionCode)
                    }))
                );

                // Group by correlation
                const correlations = [...new Set(filteredEvents.value.map(e => e.correlationId || 'unknown'))];
                const groups = new DataSet(
                    correlations.map((corr, idx) => ({
                        id: corr,
                        content: corr.substring(0, 16)
                    }))
                );

                // Assign groups
                items.forEach(item => {
                    const event = filteredEvents.value.find(e => e.id === item.id);
                    if (event?.correlationId) {
                        items.update({ id: item.id, group: event.correlationId });
                    }
                });

                const container = timelineContainer.value;
                // Clear content before mounting
                if (container.querySelector('.vis-timeline')) {
                    container.querySelector('.vis-timeline').remove();
                }

                timeline = new Timeline(container, items, groups, {
                    orientation: 'top',
                    showMajorLabels: true,
                    showMinorLabels: true,
                    height: '100%',
                    margin: { axis: 10, item: { horizontal: 10, vertical: 10 } },
                    locale: 'pt'
                });

                timeline.on('select', (properties) => {
                    if (properties.items.length > 0) {
                        const eventId = properties.items[0];
                        const event = events.value.find(e => e.id === eventId);
                        if (event) {
                            selectEvent(event);
                        }
                    }
                });
            });
        }

        // Watch for filter changes to re-render timeline
        watch(filteredEvents, () => {
            renderTimeline();
        }, { deep: true });

        // Select event
        function selectEvent(event) {
            selectedEvent.value = event;
        }

        // Clear events
        function clearEvents() {
            events.value = [];
            selectedEvent.value = null;
            if (timeline) {
                timeline.destroy();
                timeline = null;
            }
        }

        // Get event category for styling
        function getEventCategory(actionCode) {
            if (!actionCode) return 'unknown';
            if (actionCode.includes('STARTED') || actionCode.includes('PROGRESS')) return 'info';
            if (actionCode.includes('COMPLETED')) return 'success';
            if (actionCode.includes('FAILED') || actionCode.includes('ERROR')) return 'danger';
            if (actionCode.includes('KERNEL')) return 'kernel';
            if (actionCode.includes('DRIVER')) return 'driver';
            return 'default';
        }

        // Format helpers
        function formatTime(timestamp) {
            if (!timestamp) return '-';
            return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        function formatFullTime(timestamp) {
            if (!timestamp) return '-';
            return new Date(timestamp).toLocaleString('pt-BR');
        }

        function truncate(str, maxLen) {
            if (!str) return '-';
            return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
        }

        // Cleanup
        onUnmounted(() => {
            if (timeline) {
                timeline.destroy();
                timeline = null;
            }
        });

        return {
            timelineContainer,
            events,
            selectedEvent,
            filterType,
            filterCorrelation,
            timePeriod,
            currentPage,
            pageSize,
            filteredEvents,
            paginatedEvents,
            totalPages,
            correlationChain,
            loadSampleEvents,
            clearEvents,
            selectEvent,
            getEventCategory,
            formatTime,
            formatFullTime,
            truncate
        };
    }
};
</script>

<style scoped>
.event-correlation {
    padding: 20px;
    max-width: 1600px;
    margin: 0 auto;
}

/* Header */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
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

.event-count {
    font-size: 0.8rem;
    color: #64748b;
}

/* Filters */
.filters-bar {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
}

.filter-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.filter-group label {
    font-size: 0.7rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
}

.filter-select,
.filter-input {
    padding: 5px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #475569;
    background: #fff;
    min-width: 140px;
}

.filter-input {
    min-width: 200px;
}

.filter-select:focus,
.filter-input:focus {
    outline: none;
    border-color: #3b82f6;
}

/* Timeline Section */
.timeline-section {
    margin-bottom: 20px;
}

.timeline-container {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    min-height: 200px;
    overflow: hidden;
    position: relative;
}

.timeline-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 200px;
    gap: 6px;
}

.timeline-empty p {
    color: #94a3b8;
    font-size: 0.85rem;
    margin: 0;
}

.timeline-hint {
    font-size: 0.75rem !important;
    color: #cbd5e1 !important;
}

/* Event Table */
.event-table-section {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
}

.event-table-section > h3 {
    font-size: 0.9rem;
    font-weight: 600;
    color: #475569;
    margin: 0;
    padding: 12px 16px;
    border-bottom: 1px solid #f1f5f9;
    background: #f8fafc;
}

.table-wrapper {
    overflow-x: auto;
    max-height: 320px;
    overflow-y: auto;
}

.event-table {
    width: 100%;
    border-collapse: collapse;
}

.event-table th {
    text-align: left;
    padding: 8px 12px;
    font-size: 0.7rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    position: sticky;
    top: 0;
}

.event-table td {
    padding: 8px 12px;
    font-size: 0.8rem;
    color: #475569;
    border-bottom: 1px solid #f1f5f9;
    white-space: nowrap;
}

.event-row {
    cursor: pointer;
    transition: background 0.1s;
}

.event-row:hover {
    background: #f8fafc;
}

/* Event Categories */
.event-row.event-info { border-left: 3px solid #3b82f6; }
.event-row.event-success { border-left: 3px solid #22c55e; }
.event-row.event-danger { border-left: 3px solid #ef4444; }
.event-row.event-kernel { border-left: 3px solid #8b5cf6; }
.event-row.event-driver { border-left: 3px solid #f59e0b; }
.event-row.event-default { border-left: 3px solid #94a3b8; }

.type-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    white-space: nowrap;
}

.badge-info { background: #dbeafe; color: #1d4ed8; }
.badge-success { background: #dcfce7; color: #166534; }
.badge-danger { background: #fee2e2; color: #991b1b; }
.badge-kernel { background: #ede9fe; color: #6d28d9; }
.badge-driver { background: #fef3c7; color: #92400e; }
.badge-default { background: #f1f5f9; color: #64748b; }

/* Pagination */
.pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid #f1f5f9;
}

.page-info {
    font-size: 0.8rem;
    color: #64748b;
}

/* Event Detail */
.event-detail {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    margin-top: 16px;
    overflow: hidden;
}

.detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f8fafc;
    border-bottom: 1px solid #f1f5f9;
}

.detail-header h3 {
    font-size: 0.85rem;
    font-weight: 600;
    color: #475569;
    margin: 0;
}

.close-btn {
    background: none;
    border: none;
    font-size: 0.85rem;
    color: #94a3b8;
    cursor: pointer;
    padding: 2px 6px;
}

.close-btn:hover {
    color: #475569;
}

.detail-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.detail-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
}

.detail-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    min-width: 100px;
    text-transform: uppercase;
}

.detail-value {
    font-size: 0.8rem;
    color: #1e293b;
    font-family: 'SF Mono', monospace;
    word-break: break-all;
}

.detail-payload {
    font-size: 0.75rem;
    color: #475569;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 0;
    font-family: 'SF Mono', monospace;
    flex: 1;
}

/* Correlation Chain */
.correlation-chain {
    margin-top: 10px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
}

.correlation-chain h4 {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    margin: 0 0 8px 0;
}

.chain-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.chain-item {
    display: flex;
    gap: 10px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
}

.chain-item.chain-current {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
}

.chain-time {
    color: #94a3b8;
    min-width: 70px;
}

.chain-type {
    color: #475569;
    font-weight: 600;
}

/* Buttons */
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

/* Responsive */
@media (max-width: 900px) {
    .filters-bar {
        flex-wrap: wrap;
    }

    .event-table th,
    .event-table td {
        padding: 6px 8px;
    }
}

@media (max-width: 600px) {
    .event-table {
        font-size: 0.7rem;
    }

    .col-details {
        display: none;
    }
}
</style>
