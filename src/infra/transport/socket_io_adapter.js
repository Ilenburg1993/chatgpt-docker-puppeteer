/* ==========================================================================
   src/infra/transport/socket_io_adapter.js
   Audit Level: 590 — Physical Transport Layer (Socket.io Implementation)
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: 
     - Envelopar a biblioteca 'socket.io-client'.
     - Traduzir eventos de rede física para eventos do NERV.
     - Garantir que erros de conexão não derrubem o processo.
========================================================================== */

const { io } = require('socket.io-client');
const EventEmitter = require('events');

/**
 * Cria uma instância do adaptador de transporte para Socket.io.
 * * @param {object} config
 * @param {string} config.url - URL do servidor (ex: http://localhost:3000).
 * @param {object} [config.options] - Opções nativas do socket.io-client.
 */
function createSocketAdapter(config) {
    // Bus de eventos para comunicar mudanças de estado ao NERV Core
    const events = new EventEmitter();
    
    // Adiciona handler de erro padrão para evitar crashes
    events.on('error', (errorData) => {
        // Log silencioso - erros de conexão são esperados durante shutdown
        if (!_shuttingDown) {
            // Apenas emite no log interno, não propaga
            events.emit('log', { 
                level: 'DEBUG', 
                msg: `[TRANSPORT] Connection error: ${errorData.msg}` 
            });
        }
    });
    
    // Instância nativa do socket (inicializada em start)
    let socket = null;
    
    // Handler injetado pelo NERV para receber dados
    let inboundHandler = null;
    
    // Flag de shutdown para evitar erros durante desligamento
    let _shuttingDown = false;

    /**
     * Inicia a conexão física.
     */
    function start() {
        if (socket) return; // Já iniciado

        // Configuração de robustez padrão
        const opts = {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000,
            transports: ['websocket'], // Força WebSocket para performance
            ...config.options
        };

        socket = io(config.url, opts);

        setupListeners();
    }

    /**
     * Configura os ouvintes nativos do Socket.io
     */
    function setupListeners() {
        // 1. Conexão Física Estabelecida
        socket.on('connect', () => {
            events.emit('connect');
            events.emit('log', { level: 'INFO', msg: `[TRANSPORT] Conectado a ${config.url} (ID: ${socket.id})` });
        });

        // 2. Desconexão
        socket.on('disconnect', (reason) => {
            events.emit('disconnect');
            events.emit('log', { level: 'WARN', msg: `[TRANSPORT] Desconectado: ${reason}` });
        });

        // 3. Erros de Conexão (silenciado durante shutdown)
        socket.on('connect_error', (err) => {
            // Ignora erros de conexão se já estamos desligando
            if (_shuttingDown) return;
            
            events.emit('error', { 
                code: 'CONNECTION_ERROR', 
                msg: err.message 
            });
        });

        // 4. Recebimento de Dados (Payload do NERV)
        // O servidor envia eventos no canal 'message'
        socket.on('message', (rawFrame) => {
            if (inboundHandler) {
                try {
                    inboundHandler(rawFrame);
                } catch (err) {
                    events.emit('error', { 
                        code: 'INBOUND_HANDLER_FAIL', 
                        msg: `Erro ao processar pacote de entrada: ${err.message}` 
                    });
                }
            }
        });
    }

    /**
     * Encerra a conexão física.
     */
    function stop() {        _shuttingDown = true;        if (socket) {
            socket.removeAllListeners();
            socket.disconnect();
            socket = null;
            events.emit('disconnect');
        }
    }

    /**
     * Envia dados brutos para o servidor.
     * @param {string|object} frame - O pacote já serializado pelo NERV.
     */
    function send(frame) {
        if (!socket || !socket.connected) {
            // Nota: O NERV Core (Backpressure) deve evitar chamar send se não estiver READY.
            // Mas se chamar, avisamos do erro.
            events.emit('error', { code: 'SEND_FAILED', msg: 'Transporte desconectado.' });
            return;
        }

        // Emite no canal padrão 'message'
        socket.emit('message', frame);
    }

    /**
     * Registra a função que o NERV usará para processar o que chega.
     * @param {Function} handler - Função (frame) => void
     */
    function onReceive(handler) {
        inboundHandler = handler;
    }

    return {
        start,
        stop,
        send,
        onReceive,
        events // Exposto para o NERV ouvir 'connect', 'disconnect', etc.
    };
}

module.exports = createSocketAdapter;