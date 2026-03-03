// @ts-check
/**
 * Composable: useRealtime
 *
 * Integra Socket.io com Pinia stores para updates em tempo real.
 * - Escuta eventos de telemetria
 * - Escuta updates de tasks
 * - Escuta alertas
 * - Atualiza stores automaticamente
 */

import { useSystemStore } from '@/stores/system';
import { useTaskStore } from '@/stores/tasks';
import { useTelemetryStore } from '@/stores/telemetry';
import { onMounted, onUnmounted, watch } from 'vue';
import { useSocket } from './useSocket';

/**
 * Composable para integração real-time com stores
  * @returns {any}
 */
export function useRealtime(options = {}) {
    const { subscribe, unsubscribe, isConnected } = useSocket();
    const taskStore = useTaskStore();
    const telemetryStore = useTelemetryStore();
    const systemStore = useSystemStore();

    // Handlers para eventos Socket.io
    const handlers = {
        // Telemetria (1Hz)
        'telemetry:metrics': data => {
            telemetryStore.handleTelemetryMetrics(data);
        },

        // Batch de updates de tasks (debounced)
        'task:updates_batch': data => {
            taskStore.handleTaskUpdatesBatch(data);
        },

        // Alertas
        'alert:triggered': data => {
            systemStore.handleAlert(data);
        },

        // Health updates por componente
        'health:api': data => {
            systemStore.handleHealthUpdate('api', data);
        },
        'health:queue': data => {
            systemStore.handleHealthUpdate('queue', data);
        },
        'health:memory': data => {
            systemStore.handleHealthUpdate('memory', data);
        },
        'health:kernel': data => {
            systemStore.handleHealthUpdate('kernel', data);
        },
    };

    /**
     * Registra todos os handlers
     */
    const setupListeners = () => {
        Object.entries(handlers).forEach(([event, handler]) => {
            subscribe(event, handler);
        });
        console.info('[useRealtime] Listeners registrados');
    };

    /**
     * Remove todos os handlers
     */
    const removeListeners = () => {
        Object.entries(handlers).forEach(([event, handler]) => {
            unsubscribe(event, handler);
        });
        console.info('[useRealtime] Listeners removidos');
    };

    // Watch connection status
    watch(isConnected, connected => {
        telemetryStore.setConnected(connected);

        if (connected) {
            // Reload data quando reconectar
            if (options.reloadOnReconnect !== false) {
                taskStore.fetchTasks();
                systemStore.fetchHealth();
            }
        }
    });

    // Lifecycle
    onMounted(() => {
        setupListeners();

        // Carrega dados iniciais
        if (options.loadInitialData !== false) {
            taskStore.fetchTasks();
            telemetryStore.fetchCurrent();
            systemStore.fetchHealth();
        }
    });

    onUnmounted(() => {
        removeListeners();
    });

    return {
        isConnected,
        taskStore,
        telemetryStore,
        systemStore,
    };
}

export default useRealtime;
