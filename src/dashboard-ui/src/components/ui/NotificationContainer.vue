<template>
    <TransitionGroup name="notification" tag="div" class="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        <div
            v-for="notification in notifications"
            :key="notification.id"
            :class="[
                'p-4 rounded-lg shadow-lg border-l-4 flex items-start justify-between max-w-sm',
                getNotificationClasses(notification.type),
            ]"
        >
            <div class="flex-1 pr-2">
                <p class="text-sm font-medium">{{ notification.message }}</p>
            </div>
            <button
                @click="removeNotification(notification.id)"
                class="flex-shrink-0 ml-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600"
                :aria-label="'Fechar notificação'"
            >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                        fill-rule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clip-rule="evenodd"
                    ></path>
                </svg>
            </button>
        </div>
    </TransitionGroup>
</template>

<script setup>
// @ts-check
import { useNotifications } from '../../composables/useNotifications.js';

/**
 * Componente de notificações para o dashboard
 * Exibe notificações em tempo real com animações e auto-remocão
 *
 * @sideEffects - Renderiza notificações na tela, gerencia ciclo de vida das notificações
 */
const { notifications, removeNotification } = useNotifications();

/**
 * Retorna classes CSS baseadas no tipo de notificação
 * @param {'success'|'error'|'warning'|'info'} type - Tipo da notificação
 * @returns {string} Classes CSS para o tipo
 */
const getNotificationClasses = type => {
    const baseClasses = 'bg-white text-gray-800 border-gray-300';

    switch (type) {
        case 'success':
            return `${baseClasses} border-green-500 bg-green-50 text-green-800`;
        case 'error':
            return `${baseClasses} border-red-500 bg-red-50 text-red-800`;
        case 'warning':
            return `${baseClasses} border-yellow-500 bg-yellow-50 text-yellow-800`;
        case 'info':
        default:
            return `${baseClasses} border-blue-500 bg-blue-50 text-blue-800`;
    }
};
</script>

<style scoped>
/* Animações de entrada/saída das notificações */
.notification-enter-active,
.notification-leave-active {
    transition: all 0.3s ease;
}

.notification-enter-from {
    opacity: 0;
    transform: translateX(100%);
}

.notification-leave-to {
    opacity: 0;
    transform: translateX(100%);
}

.notification-move {
    transition: transform 0.3s ease;
}
</style>
