<script setup>
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';
import { computed } from 'vue';

const props = defineProps({
    variant: {
        type: String,
        default: 'primary',
        validator: v => ['primary', 'secondary', 'ghost', 'danger', 'outline'].includes(v),
    },
    size: {
        type: String,
        default: 'md',
        validator: v => ['sm', 'md', 'lg'].includes(v),
    },
    disabled: {
        type: Boolean,
        default: false,
    },
    loading: {
        type: Boolean,
        default: false,
    },
    class: {
        type: String,
        default: '',
    },
});

const emit = defineEmits(['click']);

const buttonVariants = cva(
    'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed',
    {
        variants: {
            variant: {
                primary: 'bg-primary hover:bg-primary-hover text-white shadow-sm',
                secondary: 'bg-background-secondary hover:bg-background-tertiary text-foreground border border-border',
                ghost: 'hover:bg-background-secondary text-foreground-muted hover:text-foreground',
                danger: 'bg-error hover:bg-error/90 text-white shadow-sm',
                outline: 'border-2 border-primary text-primary hover:bg-primary hover:text-white',
            },
            size: {
                sm: 'h-8 px-3 text-sm gap-1.5',
                md: 'h-10 px-4 text-base gap-2',
                lg: 'h-12 px-6 text-lg gap-2.5',
            },
        },
        defaultVariants: {
            variant: 'primary',
            size: 'md',
        },
    }
);

const buttonClass = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size }), props.class));

const handleClick = event => {
    if (!props.disabled && !props.loading) {
        emit('click', event);
    }
};
</script>

<template>
    <button :class="buttonClass" :disabled="disabled || loading" @click="handleClick">
        <svg
            v-if="loading"
            class="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
        >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
        </svg>
        <slot />
    </button>
</template>
