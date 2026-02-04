<script setup>
import { cn } from '@/lib/utils';
import { computed } from 'vue';

const props = defineProps({
    hoverable: {
        type: Boolean,
        default: false,
    },
    class: {
        type: String,
        default: '',
    },
});

const cardClass = computed(() =>
    cn(
        'backdrop-blur-sm bg-slate-900/50 border border-slate-700/50 rounded-2xl shadow-xl transition-all duration-300',
        props.hoverable &&
            'hover:border-blue-500/50 hover:shadow-2xl hover:shadow-blue-500/10 cursor-pointer hover:scale-[1.02]',
        props.class
    )
);
</script>

<template>
    <div :class="cardClass">
        <div
            v-if="$slots.header"
            class="px-6 py-5 border-b border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-transparent"
        >
            <slot name="header" />
        </div>

        <div class="px-6 py-6">
            <slot />
        </div>

        <div
            v-if="$slots.footer"
            class="px-6 py-4 border-t border-slate-700/50 bg-gradient-to-r from-transparent to-slate-800/50"
        >
            <slot name="footer" />
        </div>
    </div>
</template>
