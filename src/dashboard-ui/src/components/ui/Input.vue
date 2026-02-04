<script setup>
import { cn } from '@/lib/utils';
import { computed } from 'vue';

const props = defineProps({
    modelValue: {
        type: [String, Number],
        default: '',
    },
    type: {
        type: String,
        default: 'text',
    },
    placeholder: {
        type: String,
        default: '',
    },
    disabled: {
        type: Boolean,
        default: false,
    },
    error: {
        type: String,
        default: '',
    },
    class: {
        type: String,
        default: '',
    },
});

const emit = defineEmits(['update:modelValue']);

const inputClass = computed(() =>
    cn(
        'w-full bg-background-tertiary border text-foreground placeholder:text-foreground-subtle rounded-lg px-3 py-2 text-sm transition-colors duration-200',
        'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        props.error ? 'border-error focus:ring-error/30' : 'border-border',
        props.class
    )
);

const handleInput = event => {
    emit('update:modelValue', event.target.value);
};
</script>

<template>
    <div class="w-full">
        <input
            :type="type"
            :value="modelValue"
            :placeholder="placeholder"
            :disabled="disabled"
            :class="inputClass"
            @input="handleInput"
        />
        <p v-if="error" class="mt-1 text-sm text-error">
            {{ error }}
        </p>
    </div>
</template>
