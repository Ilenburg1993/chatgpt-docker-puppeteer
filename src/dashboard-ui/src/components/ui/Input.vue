<script setup lang="ts">
import { cn } from '@/lib/utils';
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue?: string | number | null;
        id?: string;
        type?: string;
        placeholder?: string;
        disabled?: boolean;
        required?: boolean;
        error?: string;
        class?: string;
    }>(),
    { modelValue: '', type: 'text', placeholder: '', disabled: false, required: false, error: '', class: '' },
);

const emit = defineEmits<{
    'update:modelValue': [value: string];
    keyup: [event: KeyboardEvent];
}>();

const inputClass = computed(() =>
    cn(
        'w-full bg-background-tertiary border text-foreground placeholder:text-foreground-subtle rounded-lg px-3 py-2 text-sm transition-colors duration-200',
        'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        props.error ? 'border-error focus:ring-error/30' : 'border-border',
        props.class,
    ),
);

const handleInput = (event: Event) => {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
};
</script>

<template>
    <div class="w-full">
        <input
            :type="type"
            :id="id"
            :value="modelValue"
            :placeholder="placeholder"
            :disabled="disabled"
            :required="required"
            :class="inputClass"
            @input="handleInput"
            @keyup="emit('keyup', $event)"
        />
        <p v-if="error" class="mt-1 text-sm text-error">
            {{ error }}
        </p>
    </div>
</template>
