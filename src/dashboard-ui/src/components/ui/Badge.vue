<script setup>
import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';
import { computed } from 'vue';

const props = defineProps({
    variant: {
        type: String,
        default: 'default',
        validator: v => ['default', 'success', 'warning', 'error', 'info'].includes(v),
    },
    size: {
        type: String,
        default: 'md',
        validator: v => ['sm', 'md', 'lg'].includes(v),
    },
    class: {
        type: String,
        default: '',
    },
});

const badgeVariants = cva('inline-flex items-center justify-center rounded-md font-medium', {
    variants: {
        variant: {
            default: 'bg-background-tertiary text-foreground-muted',
            success: 'bg-success-muted text-success',
            warning: 'bg-warning-muted text-warning',
            error: 'bg-error-muted text-error',
            info: 'bg-info-muted text-info',
        },
        size: {
            sm: 'px-2 py-0.5 text-xs',
            md: 'px-2.5 py-1 text-sm',
            lg: 'px-3 py-1.5 text-base',
        },
    },
    defaultVariants: {
        variant: 'default',
        size: 'md',
    },
});

const badgeClass = computed(() => cn(badgeVariants({ variant: props.variant, size: props.size }), props.class));
</script>

<template>
    <span :class="badgeClass">
        <slot />
    </span>
</template>
