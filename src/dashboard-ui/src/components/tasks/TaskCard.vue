<script setup>
import { CheckCircle, Clock, Pause, XCircle } from 'lucide-vue-next';
import { computed } from 'vue';
import Badge from '../ui/Badge.vue';
import Card from '../ui/Card.vue';

const props = defineProps({
    task: {
        type: Object,
        required: true,
    },
});

const emit = defineEmits(['view', 'edit', 'delete', 'cancel']);

const statusIcon = computed(() => {
    const icons = {
        RUNNING: Clock,
        DONE: CheckCircle,
        FAILED: XCircle,
        PAUSED: Pause,
    };
    return icons[props.task.unified_status] || Clock;
});

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

const getPriorityVariant = (priority) => {
    if (priority >= 8) return 'error';
    if (priority >= 5) return 'warning';
    return 'default';
};

const getPriorityLabel = (priority) => {
    if (priority >= 8) return 'HIGH';
    if (priority >= 5) return 'MEDIUM';
    return 'LOW';
};

const truncate = (text, length = 100) => {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
};
</script>

<template>
    <Card hoverable class="cursor-pointer" @click="emit('view', task)">
        <div class="space-y-3">
            <div class="flex items-start justify-between">
                <div class="flex items-center gap-2">
                    <component
                        :is="statusIcon"
                        :size="18"
                        :class="{
                            'text-info': task.unified_status === 'RUNNING',
                            'text-success': task.unified_status === 'DONE',
                            'text-error': task.unified_status === 'FAILED',
                            'text-warning': ['PAUSED', 'CANCELLED'].includes(task.unified_status),
                            'text-foreground-muted': task.unified_status === 'PENDING',
                        }"
                    />
                    <span class="text-xs font-mono text-foreground-muted">
                        {{ task.meta?.id?.substring(0, 8) || 'N/A' }}
                    </span>
                </div>

                <div class="flex gap-2">
                    <Badge :variant="getStatusVariant(task.unified_status)" size="sm">
                        {{ task.unified_status || 'UNKNOWN' }}
                    </Badge>
                    <Badge :variant="getPriorityVariant(task.meta?.priority || 0)" size="sm">
                        {{ getPriorityLabel(task.meta?.priority || 0) }}
                    </Badge>
                </div>
            </div>

            <div>
                <p class="text-sm text-foreground line-clamp-2">
                    {{ truncate(task.spec?.payload?.user_message || 'No prompt', 120) }}
                </p>
            </div>

            <div class="flex items-center justify-between text-xs text-foreground-muted">
                <span v-if="task.meta?.agent"> Agent: {{ task.meta.agent }} </span>
                <span v-if="task.meta?.created_at">
                    {{ new Date(task.meta.created_at).toLocaleDateString() }}
                </span>
            </div>
        </div>
    </Card>
</template>
