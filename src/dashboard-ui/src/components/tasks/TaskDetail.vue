<script setup>
import { Calendar, Clock, FileText, Tag, User } from 'lucide-vue-next';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Modal from '../ui/Modal.vue';

const props = defineProps({
    open: {
        type: Boolean,
        default: false,
    },
    task: {
        type: Object,
        default: null,
    },
});

const emit = defineEmits(['update:open', 'edit', 'delete', 'cancel']);

const handleClose = () => {
    emit('update:open', false);
};

const getStatusVariant = status => {
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

const getPriorityVariant = priority => {
    if (priority >= 8) return 'error';
    if (priority >= 5) return 'warning';
    return 'default';
};

const formatDate = date => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
};
</script>

<template>
    <Modal :open="open" @update:open="handleClose" size="lg">
        <template #title> Task Details </template>

        <template #description>
            <div class="flex items-center gap-2">
                <span class="text-xs font-mono text-foreground-muted"> ID: {{ task?.meta?.id || 'N/A' }} </span>
                <Badge :variant="getStatusVariant(task?.unified_status)" size="sm">
                    {{ task?.unified_status || 'UNKNOWN' }}
                </Badge>
                <Badge :variant="getPriorityVariant(task?.meta?.priority || 0)" size="sm">
                    Priority: {{ task?.meta?.priority || 0 }}
                </Badge>
            </div>
        </template>

        <div v-if="task" class="space-y-6">
            <div>
                <h3 class="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <FileText :size="16" />
                    Prompt
                </h3>
                <p class="text-sm text-foreground-muted bg-background-tertiary rounded-lg p-3">
                    {{ task.spec?.payload?.user_message || 'No prompt provided' }}
                </p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <h3 class="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <User :size="16" />
                        Agent
                    </h3>
                    <p class="text-sm text-foreground-muted">
                        {{ task.meta?.agent || 'N/A' }}
                    </p>
                </div>

                <div>
                    <h3 class="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Tag :size="16" />
                        Model
                    </h3>
                    <p class="text-sm text-foreground-muted">
                        {{ task.spec?.payload?.model || 'N/A' }}
                    </p>
                </div>

                <div>
                    <h3 class="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Calendar :size="16" />
                        Created At
                    </h3>
                    <p class="text-sm text-foreground-muted">
                        {{ formatDate(task.meta?.created_at) }}
                    </p>
                </div>

                <div>
                    <h3 class="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <Clock :size="16" />
                        Updated At
                    </h3>
                    <p class="text-sm text-foreground-muted">
                        {{ formatDate(task.meta?.updated_at) }}
                    </p>
                </div>
            </div>

            <div v-if="task.spec?.payload?.context">
                <h3 class="text-sm font-semibold text-foreground mb-2">Context</h3>
                <pre class="text-xs text-foreground-muted bg-background-tertiary rounded-lg p-3 overflow-x-auto">{{
                    JSON.stringify(task.spec.payload.context, null, 2)
                }}</pre>
            </div>

            <div v-if="task.result">
                <h3 class="text-sm font-semibold text-foreground mb-2">Result</h3>
                <pre
                    class="text-xs text-foreground-muted bg-background-tertiary rounded-lg p-3 overflow-x-auto max-h-40"
                    >{{ JSON.stringify(task.result, null, 2) }}</pre
                >
            </div>
        </div>

        <template #footer>
            <div class="flex justify-between w-full">
                <div class="flex gap-2">
                    <Button
                        v-if="task?.unified_status === 'PENDING'"
                        variant="secondary"
                        size="sm"
                        @click="emit('edit', task)"
                    >
                        Edit
                    </Button>
                    <Button
                        v-if="task?.unified_status === 'RUNNING'"
                        variant="danger"
                        size="sm"
                        @click="emit('cancel', task)"
                    >
                        Cancel
                    </Button>
                    <Button
                        v-if="['DONE', 'FAILED', 'CANCELLED'].includes(task?.unified_status)"
                        variant="danger"
                        size="sm"
                        @click="emit('delete', task)"
                    >
                        Delete
                    </Button>
                </div>
                <Button variant="ghost" size="sm" @click="handleClose"> Close </Button>
            </div>
        </template>
    </Modal>
</template>
