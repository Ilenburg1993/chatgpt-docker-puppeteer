<template>
    <header class="app-header">
        <div class="logo">
            <h1>🤖 Mission Control</h1>
        </div>
        <div class="header-actions">
            <div class="status-indicator" :class="{ connected: isConnected }">
                <span class="dot"></span>
                {{ isConnected ? 'Connected' : 'Disconnected' }}
            </div>
        </div>
    </header>
</template>

<script>
import { ref } from 'vue';

export default {
    name: 'Header',
    setup() {
        const isConnected = ref(true);

        return {
            isConnected
        };
    }
};
</script>

<style scoped>
.app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 60px;
    padding: 0 20px;
    background-color: #2c3e50;
    color: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.logo h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 20px;
}

.status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 4px;
    background-color: rgba(255, 255, 255, 0.1);
    font-size: 0.9rem;
}

.status-indicator .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #e74c3c;
    animation: pulse 2s infinite;
}

.status-indicator.connected .dot {
    background-color: #2ecc71;
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}
</style>
