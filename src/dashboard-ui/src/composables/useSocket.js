// @ts-check
/**
 * Composable: useSocket
 *
 * Gerencia conexão Socket.io com o backend.
 * - Conecta/desconecta automaticamente
 * - Expõe métodos para subscribe/emit
 * - Mantém status de conexão reativo
 */

import { io } from 'socket.io-client';
import { onMounted, onUnmounted, ref } from 'vue';

// Singleton da conexão Socket.io
let socketInstance = null;
let connectionCount = 0;
let handlersInitialized = false;
const isConnected = ref(false);
const error = ref(null);
const reconnectAttempts = ref(0);

function getDashboardToken() {
    try {
        return localStorage.getItem('auth_token');
    } catch {
        return null;
    }
}

/**
 * Cria ou retorna instância existente do Socket.io
 */
function getSocketInstance(url = '', options = {}) {
    if (!socketInstance) {
        socketInstance = io(url, {
            transports: ['websocket'],
            autoConnect: false,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            auth: cb => cb({ token: getDashboardToken() }),
            ...options,
        });
    }
    return socketInstance;
}

/**
 * Composable para gerenciar conexão Socket.io
  * @returns {any}
 */
export function useSocket(options = {}) {
    const socket = getSocketInstance(options.url || '', options);

    /**
     * Conecta ao servidor
     */
    const connect = () => {
        if (!socket.connected) {
            socket.connect();
        }
    };

    /**
     * Desconecta do servidor
     */
    const disconnect = () => {
        if (connectionCount <= 1 && socket.connected) {
            socket.disconnect();
        }
    };

    /**
     * Inscreve em um evento
     */
    const subscribe = (event, handler) => {
        socket.on(event, handler);
    };

    /**
     * Remove inscrição de evento
     */
    const unsubscribe = (event, handler) => {
        socket.off(event, handler);
    };

    /**
     * Emite evento para o servidor
     */
    const emit = (event, data) => {
        if (socket.connected) {
            socket.emit(event, data);
        }
    };

    // Setup event handlers
    const setupHandlers = () => {
        if (handlersInitialized) {
            return;
        }
        handlersInitialized = true;

        socket.on('connect', () => {
            isConnected.value = true;
            error.value = null;
            reconnectAttempts.value = 0;
            if (import.meta.env.DEV) {
                console.info('[Socket.io] Connected');
            }
        });

        socket.on('disconnect', reason => {
            isConnected.value = false;
            if (import.meta.env.DEV) {
                console.info('[Socket.io] Disconnected:', reason);
            }
        });

        socket.on('connect_error', err => {
            error.value = err.message;
            isConnected.value = false;
            if (import.meta.env.DEV) {
                console.error('[Socket.io] Connection error:', err);
            }
        });

        socket.on('reconnect_attempt', attempt => {
            reconnectAttempts.value = attempt;
            if (import.meta.env.DEV) {
                console.info('[Socket.io] Reconnect attempt:', attempt);
            }
        });

        socket.on('reconnect', () => {
            isConnected.value = true;
            error.value = null;
            if (import.meta.env.DEV) {
                console.info('[Socket.io] Reconnected');
            }
        });
    };

    const teardownHandlers = () => {
        if (!handlersInitialized) return;
        handlersInitialized = false;
        socket.off('connect');
        socket.off('disconnect');
        socket.off('connect_error');
        socket.off('reconnect_attempt');
        socket.off('reconnect');
    };

    // Lifecycle
    onMounted(() => {
        connectionCount++;
        if (connectionCount === 1) {
            setupHandlers();
        }
        connect();
    });

    onUnmounted(() => {
        connectionCount--;
        if (connectionCount === 0) {
            disconnect();
            teardownHandlers();
        }
    });

    return {
        socket,
        isConnected,
        error,
        reconnectAttempts,
        connect,
        disconnect,
        subscribe,
        unsubscribe,
        emit,
    };
}

export default useSocket;
