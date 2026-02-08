<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Plus } from 'lucide-vue-next';
import { formatHttpError, http } from '@/lib/http';
import { useSocket } from '../composables/useSocket';
import Button from '../components/ui/Button.vue';
import TaskList from '../components/tasks/TaskList.vue';
import TaskFilters from '../components/tasks/TaskFilters.vue';
import TaskDetail from '../components/tasks/TaskDetail.vue';
import TaskForm from '../components/tasks/TaskForm.vue';

const tasks = ref([]);
const loading = ref(false);
const error = ref(null);

const filters = ref({
    status: null,
    priority: null,
    search: '',
});

const selectedTask = ref(null);
const showDetail = ref(false);
const showForm = ref(false);
const formMode = ref('create');

const { isConnected, connect, disconnect, subscribe, unsubscribe } = useSocket();

const filteredTasks = computed(() => {
    let result = [...tasks.value];

    if (filters.value.status) {
        result = result.filter(task => task.unified_status === filters.value.status);
    }

    if (filters.value.priority !== null) {
        if (filters.value.priority === 8) {
            result = result.filter(task => (task.meta?.priority || 0) >= 8);
        } else if (filters.value.priority === 5) {
            result = result.filter(task => (task.meta?.priority || 0) >= 5 && (task.meta?.priority || 0) < 8);
        } else if (filters.value.priority === 0) {
            result = result.filter(task => (task.meta?.priority || 0) < 5);
        }
    }

    if (filters.value.search) {
        const search = filters.value.search.toLowerCase();
        result = result.filter(task => {
            const id = task.meta?.id?.toLowerCase() || '';
            const prompt = task.spec?.payload?.user_message?.toLowerCase() || '';
            return id.includes(search) || prompt.includes(search);
        });
    }

    return result;
});

const fetchTasks = async () => {
    loading.value = true;
    error.value = null;

    try {
        const response = await http.get('/api/dashboard/tasks');
        tasks.value = response.data.tasks || [];
    } catch (err) {
        error.value = formatHttpError(err).message;
        console.error('[Tasks] Failed to fetch tasks:', err);
    } finally {
        loading.value = false;
    }
};

const createTask = async taskData => {
    try {
        await http.post('/api/tasks', taskData);
        await fetchTasks();
    } catch (err) {
        console.error('[Tasks] Failed to create task:', err);
    }
};

const updateTask = async (taskId, updates) => {
    try {
        await http.patch(`/api/tasks/${taskId}`, updates);
        await fetchTasks();
    } catch (err) {
        console.error('[Tasks] Failed to update task:', err);
    }
};

const deleteTask = async taskId => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
        await http.delete(`/api/tasks/${taskId}`);
        await fetchTasks();
    } catch (err) {
        console.error('[Tasks] Failed to delete task:', err);
    }
};

const cancelTask = async taskId => {
    if (!confirm('Are you sure you want to cancel this task?')) return;

    try {
        await http.patch(`/api/tasks/${taskId}`, {
            unified_status: 'CANCELLED',
        });
        await fetchTasks();
    } catch (err) {
        console.error('[Tasks] Failed to cancel task:', err);
    }
};

const handleView = task => {
    selectedTask.value = task;
    showDetail.value = true;
};

const handleEdit = task => {
    selectedTask.value = task;
    formMode.value = 'edit';
    showForm.value = true;
};

const handleDelete = task => {
    deleteTask(task.meta?.id);
};

const handleCancel = task => {
    cancelTask(task.meta?.id);
};

const handleFormSubmit = taskData => {
    if (formMode.value === 'create') {
        createTask(taskData);
    } else {
        updateTask(selectedTask.value.meta?.id, taskData);
    }
};

const handleCreateNew = () => {
    selectedTask.value = null;
    formMode.value = 'create';
    showForm.value = true;
};

const handleTaskUpdated = data => {
    console.log('[Tasks] Task updated via socket:', data);
    fetchTasks();
};

const handleTaskCreated = data => {
    console.log('[Tasks] Task created via socket:', data);
    fetchTasks();
};

const handleTaskCompleted = data => {
    console.log('[Tasks] Task completed via socket:', data);
    fetchTasks();
};

onMounted(() => {
    fetchTasks();

    connect();
    subscribe('task:updated', handleTaskUpdated);
    subscribe('task:created', handleTaskCreated);
    subscribe('task:completed', handleTaskCompleted);
});

onUnmounted(() => {
    unsubscribe('task:updated', handleTaskUpdated);
    unsubscribe('task:created', handleTaskCreated);
    unsubscribe('task:completed', handleTaskCompleted);
    disconnect();
});
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-foreground">Tasks</h1>
                <p class="text-sm text-foreground-muted mt-1">
                    Manage and monitor all tasks
                    <span v-if="isConnected" class="inline-flex items-center gap-1 ml-2">
                        <span class="w-2 h-2 bg-success rounded-full animate-pulse"></span>
                        <span class="text-xs">Live</span>
                    </span>
                </p>
            </div>
            <Button variant="primary" @click="handleCreateNew">
                <Plus :size="18" class="mr-1" />
                New Task
            </Button>
        </div>

        <TaskFilters v-model="filters" />

        <div v-if="error" class="p-4 bg-error/10 border border-error rounded-lg">
            <p class="text-sm text-error">{{ error }}</p>
        </div>

        <TaskList
            :tasks="filteredTasks"
            :loading="loading"
            @view="handleView"
            @edit="handleEdit"
            @delete="handleDelete"
            @cancel="handleCancel"
        />

        <TaskDetail
            :open="showDetail"
            :task="selectedTask"
            @update:open="showDetail = $event"
            @edit="handleEdit"
            @delete="handleDelete"
            @cancel="handleCancel"
        />

        <TaskForm
            :open="showForm"
            :task="selectedTask"
            :mode="formMode"
            @update:open="showForm = $event"
            @submit="handleFormSubmit"
        />
    </div>
</template>
