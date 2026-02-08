<template>
    <div class="max-w-6xl mx-auto p-6 space-y-6">
        <div class="flex items-center justify-between gap-4">
            <div class="space-y-1">
                <h1 class="text-2xl font-semibold text-foreground">Task Queue (Legacy)</h1>
                <p class="text-sm text-foreground-muted">
                    Showing {{ filteredTasks.length }} of {{ tasks.length }} tasks
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="secondary" :loading="loading" @click="refreshTasks">
                    Refresh
                </Button>
            </div>
        </div>

        <div v-if="notice" class="rounded-lg border p-4" :class="noticeClass">
            <div class="flex items-start justify-between gap-4">
                <div class="text-sm text-foreground">
                    {{ notice.message }}
                </div>
                <button class="text-foreground-muted hover:text-foreground transition-colors" @click="clearNotice">
                    ✕
                </button>
            </div>
        </div>

        <div v-if="error" class="rounded-lg border border-error/50 bg-error-muted/30 p-4">
            <div class="flex items-start justify-between gap-4">
                <div class="text-sm text-error">
                    {{ error }}
                </div>
                <button class="text-foreground-muted hover:text-foreground transition-colors" @click="clearError">
                    ✕
                </button>
            </div>
        </div>

        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background-secondary p-4">
            <div class="flex items-center gap-2">
                <label class="text-sm text-foreground-muted">Status</label>
                <select
                    v-model="statusFilter"
                    class="h-10 rounded-lg border border-border bg-background-tertiary px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                    <option :value="null">All</option>
                    <option value="PENDING">Pending</option>
                    <option value="RUNNING">Running</option>
                    <option value="DONE">Done</option>
                    <option value="FAILED">Failed</option>
                    <option value="PAUSED">Paused</option>
                    <option value="CANCELLED">Cancelled</option>
                </select>
            </div>

            <div class="flex-1 min-w-[260px]">
                <Input v-model="searchFilter" placeholder="Search by ID or prompt..." />
            </div>

            <Button variant="ghost" :disabled="!hasActiveFilters" @click="clearFilters">
                Clear Filters
            </Button>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="rounded-xl border border-border bg-background-secondary p-6">
            <div class="space-y-3 animate-pulse">
                <div class="h-4 bg-background-tertiary rounded w-1/3"></div>
                <div class="h-4 bg-background-tertiary rounded w-2/3"></div>
                <div class="h-4 bg-background-tertiary rounded w-1/2"></div>
                <div class="h-4 bg-background-tertiary rounded w-3/4"></div>
            </div>
        </div>

        <!-- Task List -->
        <div v-else class="space-y-3">
            <div
                v-for="task in filteredTasks"
                :key="task.meta?.id || task.id"
                class="rounded-xl border border-border bg-background-secondary p-4 hover:bg-background-tertiary/40 transition-colors cursor-pointer"
                @click="viewTask(task)"
            >
                <div class="flex items-start justify-between gap-4">
                    <div class="space-y-1 min-w-0">
                        <div class="font-mono text-xs text-foreground-muted truncate">
                            {{ task.meta?.id || task.id }}
                        </div>
                        <div class="text-sm text-foreground truncate">
                            {{ truncatePrompt(task.spec?.payload?.user_message || 'No prompt') }}
                        </div>
                    </div>
                    <Badge :variant="getBadgeVariant(task.unified_status)" size="sm">
                        {{ task.unified_status }}
                    </Badge>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-foreground-muted">
                    <span class="inline-flex items-center gap-1">
                        <span>🎯</span>
                        <span>{{ task.spec?.target || 'auto' }}</span>
                    </span>
                    <span class="inline-flex items-center gap-1">
                        <span>⭐</span>
                        <span>Priority: {{ task.meta?.priority || 50 }}</span>
                    </span>
                    <span v-if="task.runtime_state?.progress_percent" class="inline-flex items-center gap-1">
                        <span>📊</span>
                        <span>{{ task.runtime_state.progress_percent }}%</span>
                    </span>
                    <span class="ml-auto">
                        {{ formatDate(task.meta?.created_at) }}
                    </span>
                </div>

                <div class="mt-4 flex items-center justify-end gap-2">
                    <Button
                        v-if="task.unified_status === 'FAILED'"
                        size="sm"
                        variant="outline"
                        @click.stop="retryTask(task)"
                    >
                        Retry
                    </Button>
                    <Button size="sm" variant="danger" @click.stop="confirmDelete(task)">
                        Delete
                    </Button>
                </div>
            </div>

            <!-- Empty state -->
            <div v-if="filteredTasks.length === 0" class="rounded-xl border border-border bg-background-secondary p-10 text-center">
                <div class="text-4xl mb-3">📭</div>
                <div class="text-base font-medium text-foreground">No tasks found</div>
                <div class="mt-1 text-sm text-foreground-muted">
                    {{ hasActiveFilters ? 'Try adjusting your filters.' : 'Create a new task to get started.' }}
                </div>
            </div>
        </div>

        <!-- Bulk Actions -->
        <div v-if="tasks.length > 0" class="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="outline" :disabled="failedCount === 0" @click="retryAllFailed">
                Retry All Failed ({{ failedCount }})
            </Button>
            <Button variant="danger" @click="confirmClearQueue">
                Clear Queue
            </Button>
        </div>

        <Modal
            v-model:open="confirmOpen"
            :title="confirmTitle"
            :description="confirmDescription"
            size="sm"
        >
            <template #footer>
                <Button variant="ghost" :disabled="confirmLoading" @click="confirmOpen = false">Cancel</Button>
                <Button
                    :variant="confirmVariant"
                    :loading="confirmLoading"
                    @click="runConfirm"
                >
                    Confirm
                </Button>
            </template>
        </Modal>
    </div>
</template>

<script>
import { useRealtime } from '@/composables/useRealtime';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import { useTaskStore } from '@/stores/tasks';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

export default {
    name: 'TaskQueue',
    components: {
        Badge,
        Button,
        Input,
        Modal,
    },
    setup() {
        const router = useRouter();
        const taskStore = useTaskStore();

        // Real-time integration
        useRealtime();

        const notice = ref(null); // { type: 'success'|'info'|'error', message: string }
        let noticeTimer = null;

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

        const confirmOpen = ref(false);
        const confirmTitle = ref('');
        const confirmDescription = ref('');
        const confirmVariant = ref('primary');
        const confirmLoading = ref(false);
        /** @type {import('vue').Ref<null|(() => Promise<void>)>} */
        const confirmAction = ref(null);

        const showNotice = (type, message) => {
            notice.value = { type, message };
            if (noticeTimer) {
                clearTimeout(noticeTimer);
            }
            noticeTimer = setTimeout(() => {
                notice.value = null;
                noticeTimer = null;
            }, 4000);
        };

        const clearNotice = () => {
            if (noticeTimer) {
                clearTimeout(noticeTimer);
                noticeTimer = null;
            }
            notice.value = null;
        };

        const noticeClass = computed(() => {
            const type = notice.value?.type;
            if (type === 'success') return 'border-success/40 bg-success-muted/20';
            if (type === 'error') return 'border-error/40 bg-error-muted/20';
            return 'border-info/40 bg-info-muted/20';
        });

        const openConfirm = ({ title, description, variant = 'primary', action }) => {
            confirmTitle.value = title;
            confirmDescription.value = description;
            confirmVariant.value = variant;
            confirmAction.value = action;
            confirmOpen.value = true;
        };

        const runConfirm = async () => {
            if (!confirmAction.value) return;
            confirmLoading.value = true;
            try {
                await confirmAction.value();
                confirmOpen.value = false;
            } finally {
                confirmLoading.value = false;
                confirmAction.value = null;
            }
        };

        // Methods
        const refreshTasks = async () => {
            await taskStore.fetchTasks();
            showNotice('success', 'Tasks refreshed');
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
                showNotice('info', 'Retry is not implemented yet.');
            } catch (err) {
                showNotice('error', `Failed to retry: ${err.message}`);
            }
        };

        const confirmDelete = (task) => {
            const taskId = task.meta?.id || task.id;
            openConfirm({
                title: 'Delete task',
                description: `Delete task ${taskId}? This cannot be undone.`,
                variant: 'danger',
                action: async () => {
                    await taskStore.deleteTask(taskId);
                    showNotice('success', 'Task deleted');
                }
            });
        };

        const retryAllFailed = async () => {
            try {
                await taskStore.retryFailed();
                showNotice('success', 'Retry initiated for all failed tasks');
            } catch (err) {
                showNotice('error', `Failed to retry: ${err.message}`);
            }
        };

        const confirmClearQueue = () => {
            openConfirm({
                title: 'Clear queue',
                description: 'Are you sure you want to clear the queue? This affects all pending tasks.',
                variant: 'danger',
                action: async () => {
                    await taskStore.clearQueue();
                    showNotice('success', 'Queue cleared');
                }
            });
        };

        const getBadgeVariant = (status) => {
            const variants = {
                RUNNING: 'warning',
                PENDING: 'info',
                DONE: 'success',
                FAILED: 'error',
                PAUSED: 'info',
                CANCELLED: 'default'
            };
            return variants[status] || 'default';
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
            notice,
            noticeClass,
            clearNotice,
            refreshTasks,
            clearFilters,
            clearError,
            viewTask,
            retryTask,
            confirmDelete,
            retryAllFailed,
            confirmClearQueue,
            confirmOpen,
            confirmTitle,
            confirmDescription,
            confirmVariant,
            confirmLoading,
            runConfirm,
            getBadgeVariant,
            truncatePrompt,
            formatDate
        };
    }
};
</script>
