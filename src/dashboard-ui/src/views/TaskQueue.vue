<template>
    <div class="task-queue">
        <div class="header">
            <h1>Task Queue</h1>
            <div class="header-actions">
                <el-button type="primary" @click="refreshTasks" :loading="loading">
                    Refresh
                </el-button>
            </div>
        </div>

        <!-- Filters -->
        <div class="filters">
            <el-select
                v-model="statusFilter"
                placeholder="Filter by Status"
                clearable
                style="width: 150px"
            >
                <el-option label="Pending" value="PENDING" />
                <el-option label="Running" value="RUNNING" />
                <el-option label="Done" value="DONE" />
                <el-option label="Failed" value="FAILED" />
                <el-option label="Paused" value="PAUSED" />
            </el-select>

            <el-input
                v-model="searchFilter"
                placeholder="Search by ID or prompt..."
                clearable
                style="width: 300px"
            >
                <template #prefix>
                    <span>🔍</span>
                </template>
            </el-input>

            <el-button @click="clearFilters" :disabled="!hasActiveFilters">
                Clear Filters
            </el-button>

            <div class="filter-stats">
                Showing {{ filteredTasks.length }} of {{ tasks.length }} tasks
            </div>
        </div>

        <!-- Error message -->
        <el-alert
            v-if="error"
            :title="error"
            type="error"
            show-icon
            closable
            @close="clearError"
            style="margin-bottom: 16px"
        />

        <!-- Loading -->
        <div v-if="loading" class="loading">
            <el-skeleton :rows="5" animated />
        </div>

        <!-- Task List -->
        <div v-else class="task-list">
            <div
                v-for="task in filteredTasks"
                :key="task.meta?.id || task.id"
                class="task-card"
                :class="getStatusClass(task.unified_status)"
                @click="viewTask(task)"
            >
                <div class="task-header">
                    <div class="task-id">{{ task.meta?.id || task.id }}</div>
                    <el-tag :type="getTagType(task.unified_status)" size="small">
                        {{ task.unified_status }}
                    </el-tag>
                </div>

                <div class="task-body">
                    <div class="task-prompt">
                        {{ truncatePrompt(task.spec?.payload?.user_message || 'No prompt') }}
                    </div>

                    <div class="task-meta">
                        <span class="meta-item">
                            <span class="meta-icon">🎯</span>
                            {{ task.spec?.target || 'auto' }}
                        </span>
                        <span class="meta-item">
                            <span class="meta-icon">⭐</span>
                            Priority: {{ task.meta?.priority || 50 }}
                        </span>
                        <span v-if="task.runtime_state?.progress_percent" class="meta-item">
                            <span class="meta-icon">📊</span>
                            {{ task.runtime_state.progress_percent }}%
                        </span>
                    </div>
                </div>

                <div class="task-footer">
                    <span class="task-date">
                        {{ formatDate(task.meta?.created_at) }}
                    </span>
                    <div class="task-actions">
                        <el-button
                            v-if="task.unified_status === 'FAILED'"
                            size="small"
                            type="warning"
                            @click.stop="retryTask(task)"
                        >
                            Retry
                        </el-button>
                        <el-button
                            size="small"
                            type="danger"
                            @click.stop="deleteTask(task)"
                        >
                            Delete
                        </el-button>
                    </div>
                </div>
            </div>

            <!-- Empty state -->
            <div v-if="filteredTasks.length === 0" class="empty-state">
                <div class="empty-icon">📭</div>
                <div class="empty-text">No tasks found</div>
                <div class="empty-hint">
                    {{ hasActiveFilters ? 'Try adjusting your filters' : 'Create a new task to get started' }}
                </div>
            </div>
        </div>

        <!-- Bulk Actions -->
        <div v-if="tasks.length > 0" class="bulk-actions">
            <el-button @click="retryAllFailed" :disabled="failedCount === 0">
                Retry All Failed ({{ failedCount }})
            </el-button>
            <el-popconfirm
                title="Are you sure you want to clear the queue?"
                @confirm="clearQueue"
            >
                <template #reference>
                    <el-button type="danger">Clear Queue</el-button>
                </template>
            </el-popconfirm>
        </div>
    </div>
</template>

<script>
import { useRealtime } from '@/composables/useRealtime';
import { useTaskStore } from '@/stores/tasks';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
// TODO: Substituir por componentes customizados
// import { ElMessage, ElMessageBox } from 'element-plus';

export default {
    name: 'TaskQueue',
    setup() {
        const router = useRouter();
        const taskStore = useTaskStore();

        // Real-time integration
        useRealtime();

        // Local filter state
        const statusFilter = ref(null);
        const searchFilter = ref('');

        // Computed
        const tasks = computed(() => taskStore.tasks);
        const filteredTasks = computed(() => taskStore.filteredTasks);
        const loading = computed(() => taskStore.loading);
        const error = computed(() => taskStore.error);

        const hasActiveFilters = computed(() =>
            statusFilter.value || searchFilter.value
        );

        const failedCount = computed(() =>
            tasks.value.filter(t => t.unified_status === 'FAILED').length
        );

        // Methods
        const refreshTasks = async () => {
            await taskStore.fetchTasks();
            ElMessage.success('Tasks refreshed');
        };

        const clearFilters = () => {
            statusFilter.value = null;
            searchFilter.value = '';
            taskStore.clearFilters();
        };

        const clearError = () => {
            taskStore.clearError();
        };

        const viewTask = (task) => {
            const taskId = task.meta?.id || task.id;
            router.push(`/tasks/${taskId}`);
        };

        const retryTask = async (task) => {
            try {
                ElMessage.info('Retry not implemented yet');
            } catch (err) {
                ElMessage.error(`Failed to retry: ${err.message}`);
            }
        };

        const deleteTask = async (task) => {
            try {
                await ElMessageBox.confirm(
                    'Are you sure you want to delete this task?',
                    'Confirm Delete',
                    { type: 'warning' }
                );

                const taskId = task.meta?.id || task.id;
                await taskStore.deleteTask(taskId);
                ElMessage.success('Task deleted');
            } catch (err) {
                if (err !== 'cancel') {
                    ElMessage.error(`Failed to delete: ${err.message}`);
                }
            }
        };

        const retryAllFailed = async () => {
            try {
                await taskStore.retryFailed();
                ElMessage.success('Retry initiated for all failed tasks');
            } catch (err) {
                ElMessage.error(`Failed to retry: ${err.message}`);
            }
        };

        const clearQueue = async () => {
            try {
                await taskStore.clearQueue();
                ElMessage.success('Queue cleared');
            } catch (err) {
                ElMessage.error(`Failed to clear queue: ${err.message}`);
            }
        };

        const getStatusClass = (status) => {
            const classes = {
                RUNNING: 'running',
                PENDING: 'pending',
                DONE: 'done',
                FAILED: 'failed',
                PAUSED: 'paused'
            };
            return classes[status] || '';
        };

        const getTagType = (status) => {
            const types = {
                RUNNING: 'warning',
                PENDING: 'info',
                DONE: 'success',
                FAILED: 'danger',
                PAUSED: ''
            };
            return types[status] || 'info';
        };

        const truncatePrompt = (prompt, maxLength = 150) => {
            if (!prompt) return '';
            if (prompt.length <= maxLength) return prompt;
            return prompt.substring(0, maxLength) + '...';
        };

        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toLocaleString();
        };

        // Watch filters to update store
        watch([statusFilter, searchFilter], ([status, search]) => {
            taskStore.setFilters({ status, search });
        });

        // Load tasks on mount
        onMounted(async () => {
            await taskStore.fetchTasks();
        });

        return {
            tasks,
            filteredTasks,
            statusFilter,
            searchFilter,
            loading,
            error,
            hasActiveFilters,
            failedCount,
            refreshTasks,
            clearFilters,
            clearError,
            viewTask,
            retryTask,
            deleteTask,
            retryAllFailed,
            clearQueue,
            getStatusClass,
            getTagType,
            truncatePrompt,
            formatDate
        };
    }
};
</script>

<style scoped>
.task-queue {
    padding: 20px;
    max-width: 1200px;
    margin: 0 auto;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.header h1 {
    margin: 0;
    color: #2c3e50;
}

/* Filters */
.filters {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.filter-stats {
    margin-left: auto;
    color: #64748b;
    font-size: 0.9rem;
}

/* Loading */
.loading {
    padding: 20px;
}

/* Task List */
.task-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.task-card {
    background: white;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    cursor: pointer;
    transition: all 0.2s ease;
    border-left: 4px solid #94a3b8;
}

.task-card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    transform: translateY(-2px);
}

.task-card.running {
    border-left-color: #f59e0b;
}

.task-card.pending {
    border-left-color: #94a3b8;
}

.task-card.done {
    border-left-color: #22c55e;
}

.task-card.failed {
    border-left-color: #ef4444;
}

.task-card.paused {
    border-left-color: #8b5cf6;
}

.task-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.task-id {
    font-family: monospace;
    font-size: 0.9rem;
    color: #64748b;
}

.task-body {
    margin-bottom: 12px;
}

.task-prompt {
    color: #1e293b;
    line-height: 1.5;
    margin-bottom: 8px;
}

.task-meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
}

.meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85rem;
    color: #64748b;
}

.meta-icon {
    font-size: 1rem;
}

.task-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 12px;
    border-top: 1px solid #f1f5f9;
}

.task-date {
    font-size: 0.8rem;
    color: #94a3b8;
}

.task-actions {
    display: flex;
    gap: 8px;
}

/* Empty state */
.empty-state {
    text-align: center;
    padding: 60px 20px;
    color: #64748b;
}

.empty-icon {
    font-size: 4rem;
    margin-bottom: 16px;
}

.empty-text {
    font-size: 1.2rem;
    font-weight: 500;
    margin-bottom: 8px;
}

.empty-hint {
    font-size: 0.9rem;
    color: #94a3b8;
}

/* Bulk actions */
.bulk-actions {
    display: flex;
    gap: 12px;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
}
</style>
