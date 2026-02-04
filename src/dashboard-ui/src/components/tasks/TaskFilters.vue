<script setup>
import { Search } from 'lucide-vue-next';
import { ref } from 'vue';
import Badge from '../ui/Badge.vue';

const props = defineProps({
    modelValue: {
        type: Object,
        default: () => ({
            status: null,
            priority: null,
            search: '',
        }),
    },
});

const emit = defineEmits(['update:modelValue']);

const localFilters = ref({ ...props.modelValue });

const statusOptions = [
    { value: null, label: 'All Status' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'RUNNING', label: 'Running' },
    { value: 'PAUSED', label: 'Paused' },
    { value: 'DONE', label: 'Done' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'CANCELLED', label: 'Cancelled' },
];

const priorityOptions = [
    { value: null, label: 'All Priorities' },
    { value: 8, label: 'High (8-10)' },
    { value: 5, label: 'Medium (5-7)' },
    { value: 0, label: 'Low (0-4)' },
];

const updateFilters = () => {
    emit('update:modelValue', localFilters.value);
};

const handleStatusChange = status => {
    localFilters.value.status = status;
    updateFilters();
};

const handlePriorityChange = priority => {
    localFilters.value.priority = priority;
    updateFilters();
};

const handleSearchInput = event => {
    localFilters.value.search = event.target.value;
    updateFilters();
};

const clearFilters = () => {
    localFilters.value = {
        status: null,
        priority: null,
        search: '',
    };
    updateFilters();
};

const hasActiveFilters = () => {
    return localFilters.value.status || localFilters.value.priority !== null || localFilters.value.search;
};
</script>

<template>
    <div class="flex flex-col sm:flex-row gap-4 p-4 bg-background-secondary rounded-lg border border-border">
        <div class="flex-1">
            <div class="relative">
                <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 text-foreground-muted" :size="18" />
                <input
                    :value="localFilters.search"
                    @input="handleSearchInput"
                    type="text"
                    placeholder="Search by task ID or prompt..."
                    class="w-full pl-10 pr-4 py-2 bg-background-tertiary border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                />
            </div>
        </div>

        <div class="flex flex-wrap gap-2">
            <select
                v-model="localFilters.status"
                @change="handleStatusChange(localFilters.status)"
                class="px-3 py-2 bg-background-tertiary border border-border rounded-lg text-sm text-foreground focus:border-primary focus:outline-none"
            >
                <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>

            <select
                v-model="localFilters.priority"
                @change="handlePriorityChange(localFilters.priority)"
                class="px-3 py-2 bg-background-tertiary border border-border rounded-lg text-sm text-foreground focus:border-primary focus:outline-none"
            >
                <option v-for="option in priorityOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                </option>
            </select>

            <button
                v-if="hasActiveFilters()"
                @click="clearFilters"
                class="px-3 py-2 text-sm text-foreground-muted hover:text-foreground hover:bg-background-tertiary rounded-lg transition-colors"
            >
                Clear filters
            </button>
        </div>
    </div>
</template>
