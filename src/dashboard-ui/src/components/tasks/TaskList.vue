<script setup>
import { ChevronDown, ChevronUp, Edit, Eye, Trash2, X } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';

const props = defineProps({
    tasks: {
        type: Array,
        required: true,
    },
    loading: {
        type: Boolean,
        default: false,
    },
    compact: {
        type: Boolean,
        default: false,
    },
});

const emit = defineEmits(['view', 'edit', 'delete', 'cancel']);

const router = useRouter();

const sortKey = ref('');
const sortOrder = ref('asc');
const currentPage = ref(1);
const pageSize = ref(10);

const pageSizeOptions = [10, 25, 50];

const sortedTasks = computed(() => {
    if (!sortKey.value) return props.tasks;

    return [...props.tasks].sort((a, b) => {
        let aVal = a[sortKey.value];
        let bVal = b[sortKey.value];

        if (sortKey.value === 'priority') {
            aVal = a.meta?.priority || 0;
            bVal = b.meta?.priority || 0;
        }

        if (sortOrder.value === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    });
});

const paginatedTasks = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    const end = start + pageSize.value;
    return sortedTasks.value.slice(start, end);
});

const totalPages = computed(() => {
    return Math.ceil(props.tasks.length / pageSize.value);
});

const sortBy = (key) => {
    if (sortKey.value === key) {
        sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        sortOrder.value = 'asc';
    }
};

const getStatusVariant = (status) => {
    const variants = {
        RUNNING: 'info',
        PENDING: 'default',
        DONE: 'success',
        FAILED: 'error',
        CANCELLED: 'warning',
        PAUSED: 'warning',
    };
    return variants[status] || 'default';
};

const getPriorityLabel = (priority) => {
    if (priority >= 8) return 'HIGH';
    if (priority >= 5) return 'MEDIUM';
    return 'LOW';
};

const getPriorityVariant = (priority) => {
    if (priority >= 8) return 'error';
    if (priority >= 5) return 'warning';
    return 'default';
};

const handleView = (task) => {
    emit('view', task);
};

const handleEdit = (task) => {
    emit('edit', task);
};

const handleDelete = (task) => {
    emit('delete', task);
};

const handleCancel = (task) => {
    emit('cancel', task);
};
</script>

<template>
    <div class="space-y-4">
        <div v-if="loading" class="space-y-3">
            <div v-for="i in 5" :key="i" class="h-16 bg-background-secondary rounded-lg animate-pulse"></div>
        </div>

        <div v-else-if="tasks.length === 0" class="text-center py-12">
            <p class="text-foreground-muted">No tasks found</p>
        </div>

        <div v-else class="overflow-x-auto">
            <table class="w-full">
                <thead class="bg-background-secondary border-b border-border">
                    <tr>
                        <th
                            @click="sortBy('meta.id')"
                            class="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase cursor-pointer hover:text-foreground"
                        >
                            <div class="flex items-center gap-1">
                                Task ID
                                <ChevronUp v-if="sortKey === 'meta.id' && sortOrder === 'asc'" :size="14" />
                                <ChevronDown v-if="sortKey === 'meta.id' && sortOrder === 'desc'" :size="14" />
                            </div>
                        </th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase">Prompt</th>
                        <th
                            @click="sortBy('unified_status')"
                            class="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase cursor-pointer hover:text-foreground"
                        >
                            <div class="flex items-center gap-1">
                                Status
                                <ChevronUp v-if="sortKey === 'unified_status' && sortOrder === 'asc'" :size="14" />
                                <ChevronDown v-if="sortKey === 'unified_status' && sortOrder === 'desc'" :size="14" />
                            </div>
                        </th>
                        <th
                            @click="sortBy('priority')"
                            class="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase cursor-pointer hover:text-foreground"
                        >
                            <div class="flex items-center gap-1">
                                Priority
                                <ChevronUp v-if="sortKey === 'priority' && sortOrder === 'asc'" :size="14" />
                                <ChevronDown v-if="sortKey === 'priority' && sortOrder === 'desc'" :size="14" />
                            </div>
                        </th>
                        <th class="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase">
                            Actions
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-border">
                    <tr
                        v-for="task in paginatedTasks"
                        :key="task.meta?.id"
                        class="hover:bg-background-secondary transition-colors"
                    >
                        <td class="px-4 py-3 whitespace-nowrap">
                            <span class="text-sm font-mono text-foreground">
                                {{ task.meta?.id?.substring(0, 8) || 'N/A' }}
                            </span>
                        </td>
                        <td class="px-4 py-3">
                            <div class="max-w-md">
                                <p class="text-sm text-foreground truncate">
                                    {{ task.spec?.payload?.user_message || 'No prompt' }}
                                </p>
                            </div>
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap">
                            <Badge :variant="getStatusVariant(task.unified_status)">
                                {{ task.unified_status || 'UNKNOWN' }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap">
                            <Badge :variant="getPriorityVariant(task.meta?.priority || 0)">
                                {{ getPriorityLabel(task.meta?.priority || 0) }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 whitespace-nowrap text-right">
                            <div class="flex items-center justify-end gap-2">
                                <button
                                    @click="handleView(task)"
                                    class="p-1.5 rounded hover:bg-background-tertiary text-foreground-muted hover:text-foreground transition-colors"
                                    title="View details"
                                >
                                    <Eye :size="16" />
                                </button>
                                <button
                                    v-if="task.unified_status === 'PENDING'"
                                    @click="handleEdit(task)"
                                    class="p-1.5 rounded hover:bg-background-tertiary text-foreground-muted hover:text-foreground transition-colors"
                                    title="Edit task"
                                >
                                    <Edit :size="16" />
                                </button>
                                <button
                                    v-if="task.unified_status === 'RUNNING'"
                                    @click="handleCancel(task)"
                                    class="p-1.5 rounded hover:bg-background-tertiary text-warning hover:text-warning transition-colors"
                                    title="Cancel task"
                                >
                                    <X :size="16" />
                                </button>
                                <button
                                    v-if="['DONE', 'FAILED', 'CANCELLED'].includes(task.unified_status)"
                                    @click="handleDelete(task)"
                                    class="p-1.5 rounded hover:bg-background-tertiary text-error hover:text-error transition-colors"
                                    title="Delete task"
                                >
                                    <Trash2 :size="16" />
                                </button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div v-if="!loading && tasks.length > 0" class="flex items-center justify-between pt-4 border-t border-border">
            <div class="flex items-center gap-2">
                <span class="text-sm text-foreground-muted">Items per page:</span>
                <select
                    v-model="pageSize"
                    class="px-2 py-1 bg-background-tertiary border border-border rounded text-sm text-foreground focus:border-primary focus:outline-none"
                >
                    <option v-for="size in pageSizeOptions" :key="size" :value="size">
                        {{ size }}
                    </option>
                </select>
            </div>

            <div class="flex items-center gap-2">
                <span class="text-sm text-foreground-muted">
                    {{ (currentPage - 1) * pageSize + 1 }}-{{ Math.min(currentPage * pageSize, tasks.length) }} of
                    {{ tasks.length }}
                </span>

                <div class="flex gap-1">
                    <Button variant="ghost" size="sm" :disabled="currentPage === 1" @click="currentPage--">
                        Previous
                    </Button>
                    <Button variant="ghost" size="sm" :disabled="currentPage === totalPages" @click="currentPage++">
                        Next
                    </Button>
                </div>
            </div>
        </div>
    </div>
</template>
