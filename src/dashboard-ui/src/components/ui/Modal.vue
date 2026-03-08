<script setup>
import { cn } from '@/lib/utils';
import { X } from 'lucide-vue-next';
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
} from 'radix-vue';

const props = defineProps({
    open: {
        type: Boolean,
        default: false,
    },
    title: {
        type: String,
        default: '',
    },
    description: {
        type: String,
        default: '',
    },
    size: {
        type: String,
        default: 'md',
        validator: (v) => ['sm', 'md', 'lg', 'xl'].includes(v),
    },
});

const emit = defineEmits(['update:open']);

const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
};

const handleOpenChange = (open) => {
    emit('update:open', open);
};
</script>

<template>
    <DialogRoot :open="open" @update:open="handleOpenChange">
        <DialogPortal>
            <DialogOverlay
                class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            />
            <DialogContent
                :class="
                    cn(
                        'fixed left-[50%] top-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%]',
                        'bg-background-secondary border border-border rounded-lg shadow-xl',
                        'duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                        'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
                        'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
                        sizeClasses[size],
                    )
                "
            >
                <div class="flex flex-col space-y-4 p-6">
                    <div class="flex items-start justify-between">
                        <div class="space-y-1.5">
                            <DialogTitle v-if="title || $slots.title" class="text-xl font-semibold text-foreground">
                                <slot name="title">{{ title }}</slot>
                            </DialogTitle>
                            <DialogDescription
                                v-if="description || $slots.description"
                                class="text-sm text-foreground-muted"
                            >
                                <slot name="description">{{ description }}</slot>
                            </DialogDescription>
                        </div>
                        <DialogClose
                            class="rounded-lg p-1 text-foreground-muted hover:text-foreground hover:bg-background-tertiary transition-colors"
                        >
                            <X :size="20" />
                            <span class="sr-only">Close</span>
                        </DialogClose>
                    </div>

                    <div class="flex-1">
                        <slot />
                    </div>

                    <div v-if="$slots.footer" class="flex justify-end gap-2 pt-4 border-t border-border">
                        <slot name="footer" />
                    </div>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
