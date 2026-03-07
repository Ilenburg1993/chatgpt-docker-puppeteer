// @ts-check
/** @import { Ref } from 'vue' */
import { ref, reactive } from 'vue';

/**
 * @typedef {object} Notification
 * @property {string} id - ID único da notificação
 * @property {string} message - Mensagem da notificação
 * @property {'success'|'error'|'warning'|'info'} type - Tipo da notificação
 * @property {number} duration - Duração em ms (0 = permanente)
 * @property {number} createdAt - Timestamp de criação
 */

/** @type {Ref<Notification[]>} */
const notifications = ref([]);

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const notifTimers = new Map();

/**
 * @typedef {object} UseNotificationsReturn
 * @property {Ref<Notification[]>} notifications
 * @property {(message: string, type?: 'success'|'error'|'warning'|'info', duration?: number) => string} addNotification
 * @property {(id: string) => void} removeNotification
 * @property {(message: string, duration?: number) => string} showSuccess
 * @property {(message: string, duration?: number) => string} showError
 * @property {(message: string, duration?: number) => string} showWarning
 * @property {(message: string, duration?: number) => string} showInfo
 * @property {() => void} clearAll
 */

/**
 * Composable para gerenciamento de notificações no dashboard
 * Fornece funções para mostrar notificações de sucesso, erro, warning e info
 *
 * @returns {UseNotificationsReturn} Funções e estado das notificações
 * @sideEffects - Gerencia estado global de notificações, remove notificações automaticamente após duration
 */
export function useNotifications() {
    /**
     * Adiciona uma nova notificação
     * @param {string} message - Mensagem da notificação
     * @param {'success'|'error'|'warning'|'info'} type - Tipo da notificação
     * @param {number} [duration=5000] - Duração em ms (0 = permanente)
     */
    const addNotification = (message, type = 'info', duration = 5000) => {
        const id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const notification = reactive({
            id,
            message,
            type,
            duration,
            createdAt: Date.now(),
        });

        notifications.value.push(notification);

        // Remove automaticamente após duration (se > 0)
        if (duration > 0) {
            const timerId = setTimeout(() => {
                notifTimers.delete(id);
                removeNotification(id);
            }, duration);
            notifTimers.set(id, timerId);
        }

        return id;
    };

    /**
     * Remove uma notificação pelo ID e cancela o timer pendente
     * @param {string} id - ID da notificação a remover
     */
    const removeNotification = id => {
        const timer = notifTimers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            notifTimers.delete(id);
        }
        const index = notifications.value.findIndex(n => n.id === id);
        if (index > -1) {
            notifications.value.splice(index, 1);
        }
    };

    /**
     * Mostra notificação de sucesso
     * @param {string} message - Mensagem de sucesso
     * @param {number} [duration=3000] - Duração em ms
     */
    const showSuccess = (message, duration = 3000) => {
        return addNotification(message, 'success', duration);
    };

    /**
     * Mostra notificação de erro
     * @param {string} message - Mensagem de erro
     * @param {number} [duration=5000] - Duração em ms
     */
    const showError = (message, duration = 5000) => {
        return addNotification(message, 'error', duration);
    };

    /**
     * Mostra notificação de warning
     * @param {string} message - Mensagem de warning
     * @param {number} [duration=4000] - Duração em ms
     */
    const showWarning = (message, duration = 4000) => {
        return addNotification(message, 'warning', duration);
    };

    /**
     * Mostra notificação informativa
     * @param {string} message - Mensagem informativa
     * @param {number} [duration=3000] - Duração em ms
     */
    const showInfo = (message, duration = 3000) => {
        return addNotification(message, 'info', duration);
    };

    /**
     * Limpa todas as notificações e cancela todos os timers pendentes
     */
    const clearAll = () => {
        for (const timer of notifTimers.values()) {
            clearTimeout(timer);
        }
        notifTimers.clear();
        notifications.value = [];
    };

    return {
        notifications,
        addNotification,
        removeNotification,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        clearAll,
    };
}
