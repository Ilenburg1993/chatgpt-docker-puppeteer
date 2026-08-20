<script setup lang="ts">
import type { DashboardTask } from '@/types/dashboard';
import { reactive, ref, watch } from 'vue';
import { useNotifications } from '../../composables/useNotifications.js';
import Button from '../ui/Button.vue';
import Modal from '../ui/Modal.vue';

const props = withDefaults(
    defineProps<{ open?: boolean; task?: DashboardTask | null; mode?: 'create' | 'edit' }>(),
    { open: false, task: null, mode: 'create' },
);

type TaskFormPayload = Omit<DashboardTask, 'id'>;
const emit = defineEmits<{ 'update:open': [open: boolean]; submit: [task: TaskFormPayload] }>();

const form = reactive({
    prompt: '',
    agent: 'chatgpt',
    model: 'gpt-4',
    priority: 5,
    context: '',
});

const errors = reactive({
    prompt: '',
    agent: '',
    model: '',
    priority: '',
});

const loading = ref(false);

const { showError } = useNotifications();

const agentOptions = [
    { value: 'chatgpt', label: 'ChatGPT' },
    { value: 'gemini', label: 'Gemini' },
];

const modelOptions: Record<string, Array<{ value: string; label: string }>> = {
    chatgpt: [
        { value: 'gpt-4', label: 'GPT-4' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
    gemini: [
        { value: 'gemini-pro', label: 'Gemini Pro' },
        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
};

watch(
    () => props.open,
    (newVal) => {
        if (newVal && props.task && props.mode === 'edit') {
            form.prompt = props.task['spec']?.payload?.user_message || '';
            form.agent = props.task['meta']?.agent || 'chatgpt';
            form.model = props.task['spec']?.payload?.model || 'gpt-4';
            form.priority = props.task['meta']?.priority || 5;
            form.context = props.task['spec']?.payload?.context ? JSON.stringify(props.task['spec'].payload.context) : '';
        } else if (newVal && props.mode === 'create') {
            resetForm();
        }
    },
);

const resetForm = () => {
    form.prompt = '';
    form.agent = 'chatgpt';
    form.model = 'gpt-4';
    form.priority = 5;
    form.context = '';

    errors.prompt = '';
    errors.agent = '';
    errors.model = '';
    errors.priority = '';
};

const validate = () => {
    let isValid = true;

    errors.prompt = '';
    errors.agent = '';
    errors.model = '';
    errors.priority = '';

    if (!form.prompt || form.prompt.trim().length === 0) {
        errors.prompt = 'Prompt is required';
        isValid = false;
    } else if (form.prompt.length < 10) {
        errors.prompt = 'Prompt must be at least 10 characters';
        isValid = false;
    }

    if (!form.agent) {
        errors.agent = 'Agent is required';
        isValid = false;
    }

    if (!form.model) {
        errors.model = 'Model is required';
        isValid = false;
    }

    if (form.priority < 0 || form.priority > 10) {
        errors.priority = 'Priority must be between 0 and 10';
        isValid = false;
    }

    return isValid;
};

const handleSubmit = async () => {
    if (!validate()) return;

    loading.value = true;

    try {
        const taskData = {
            spec: {
                payload: {
                    user_message: form.prompt,
                    model: form.model,
                    context: form.context ? JSON.parse(form.context) : null,
                },
            },
            meta: {
                agent: form.agent,
                priority: form.priority,
            },
        };

        emit('submit', taskData);
        handleClose();
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Erro ao enviar formulário. Tente novamente.';
        showError(errorMessage);
    } finally {
        loading.value = false;
    }
};

const handleClose = () => {
    resetForm();
    emit('update:open', false);
};
</script>

<template>
    <Modal :open="open" @update:open="handleClose" size="lg">
        <template #title>
            {{ mode === 'create' ? 'Create New Task' : 'Edit Task' }}
        </template>

        <template #description>
            {{ mode === 'create' ? 'Fill in the details to create a new task' : 'Update task details' }}
        </template>

        <form @submit.prevent="handleSubmit" class="space-y-6">
            <div>
                <label class="block text-sm font-medium text-foreground mb-1.5">
                    Prompt <span class="text-error">*</span>
                </label>
                <textarea
                    v-model="form.prompt"
                    rows="4"
                    placeholder="Enter your task prompt..."
                    class="w-full px-3 py-2 bg-background-tertiary border rounded-lg text-foreground placeholder:text-foreground-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors resize-none"
                    :class="errors.prompt ? 'border-error' : 'border-border'"
                ></textarea>
                <p v-if="errors.prompt" class="mt-1 text-xs text-error">{{ errors.prompt }}</p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-foreground mb-1.5">
                        Agent <span class="text-error">*</span>
                    </label>
                    <select
                        v-model="form.agent"
                        class="w-full px-3 py-2 bg-background-tertiary border rounded-lg text-foreground focus:border-primary focus:outline-none"
                        :class="errors.agent ? 'border-error' : 'border-border'"
                    >
                        <option v-for="option in agentOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                    <p v-if="errors.agent" class="mt-1 text-xs text-error">{{ errors.agent }}</p>
                </div>

                <div>
                    <label class="block text-sm font-medium text-foreground mb-1.5">
                        Model <span class="text-error">*</span>
                    </label>
                    <select
                        v-model="form.model"
                        class="w-full px-3 py-2 bg-background-tertiary border rounded-lg text-foreground focus:border-primary focus:outline-none"
                        :class="errors.model ? 'border-error' : 'border-border'"
                    >
                        <option v-for="option in modelOptions[form.agent] || []" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                    <p v-if="errors.model" class="mt-1 text-xs text-error">{{ errors.model }}</p>
                </div>
            </div>

            <div>
                <label class="block text-sm font-medium text-foreground mb-1.5">
                    Priority <span class="text-error">*</span>
                </label>
                <div class="flex items-center gap-4">
                    <input v-model.number="form.priority" type="range" min="0" max="10" class="flex-1" />
                    <span class="text-sm font-mono text-foreground w-8 text-center">{{ form.priority }}</span>
                </div>
                <div class="flex justify-between text-xs text-foreground-muted mt-1">
                    <span>Low</span>
                    <span>Medium</span>
                    <span>High</span>
                </div>
                <p v-if="errors.priority" class="mt-1 text-xs text-error">{{ errors.priority }}</p>
            </div>

            <div>
                <label class="block text-sm font-medium text-foreground mb-1.5"> Context (JSON) </label>
                <textarea
                    v-model="form.context"
                    rows="3"
                    placeholder='{"key": "value"}'
                    class="w-full px-3 py-2 bg-background-tertiary border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors resize-none font-mono text-sm"
                ></textarea>
                <p class="mt-1 text-xs text-foreground-muted">Optional: Add context as JSON object</p>
            </div>
        </form>

        <template #footer>
            <div class="flex justify-end gap-2 w-full">
                <Button variant="ghost" size="sm" @click="handleClose" :disabled="loading"> Cancel </Button>
                <Button variant="primary" size="sm" @click="handleSubmit" :loading="loading">
                    {{ mode === 'create' ? 'Create Task' : 'Update Task' }}
                </Button>
            </div>
        </template>
    </Modal>
</template>
