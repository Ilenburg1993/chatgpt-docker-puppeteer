/**
 * Composable: useSocket
 *
 * Gerencia conexão Socket.io com o backend.
 * - Conecta/desconecta automaticamente
 * - Expõe métodos para subscribe/emit
 * - Mantém status de conexão reativo
 */

import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

// Singleton da conexão Socket.io
let socketInstance = null;
let connectionCount = 0;

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
            ...options
        });
    }
    return socketInstance;
}

/**
 * Composable para gerenciar conexão Socket.io
 */
export function useSocket(options = {}) {
    const socket = getSocketInstance(options.url || '', options);
    const isConnected = ref(false);
    const error = ref(null);
    const reconnectAttempts = ref(0);

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
        socket.on('connect', () => {
            isConnected.value = true;
            error.value = null;
            reconnectAttempts.value = 0;
            console.log('[Socket.io] Connected');
        });

        socket.on('disconnect', (reason) => {
            isConnected.value = false;
            console.log('[Socket.io] Disconnected:', reason);
        });

        socket.on('connect_error', (err) => {
            error.value = err.message;
            console.error('[Socket.io] Connection error:', err);
        });

        socket.on('reconnect_attempt', (attempt) => {
            reconnectAttempts.value = attempt;
            console.log('[Socket.io] Reconnect attempt:', attempt);
        });

        socket.on('reconnect', () => {
            isConnected.value = true;
            error.value = null;
            console.log('[Socket.io] Reconnected');
        });
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
        emit
    };
}

export default useSocket;
