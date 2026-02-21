<script setup>
import { useSocket } from '@/composables/useSocket';
import { onMounted, onUnmounted, ref } from 'vue';

const { isConnected } = useSocket();
const version = ref('2.0.0');
const uptime = ref('--');
let uptimeTimer = null;

onMounted(() => {
    uptimeTimer = setInterval(() => {
        const now = Date.now();
        const start = now - 3600000;
        const diff = Math.floor((now - start) / 1000);
        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        uptime.value = `${hours}h ${minutes}m`;
    }, 60000);
});

onUnmounted(() => {
    if (uptimeTimer) {
        clearInterval(uptimeTimer);
        uptimeTimer = null;
    }
});
</script>

<template>
    <footer
        class="h-10 bg-background-secondary border-t border-border flex items-center justify-between px-6 text-xs text-foreground-muted"
    >
        <div class="flex items-center gap-4">
            <span>Mission Control v{{ version }}</span>
            <span class="hidden sm:inline">|</span>
            <span class="hidden sm:inline">Uptime: {{ uptime }}</span>
        </div>

        <div class="flex items-center gap-2">
            <span :class="['flex items-center gap-1.5', isConnected ? 'text-success' : 'text-error']">
                <span
                    :class="['w-2 h-2 rounded-full', isConnected ? 'bg-success animate-pulse-slow' : 'bg-error']"
                ></span>
                {{ isConnected ? 'Connected' : 'Disconnected' }}
            </span>
        </div>
    </footer>
</template>
