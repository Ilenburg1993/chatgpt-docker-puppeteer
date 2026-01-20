/* ==========================================================================
   src/nerv/transport/connection.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: transport/
   Arquivo: connection.js

   Papel:
   - Implementar uma conexão física genérica e neutra
   - Enviar e receber frames OPACOS
   - Gerir ciclo de vida técnico (start/stop)
   - Emitir telemetria técnica sobre estado e tráfego

   IMPORTANTE:
   - NÃO interpreta frames
   - NÃO valida envelopes
   - NÃO decide retry lógico
   - NÃO garante entrega
   - NÃO conhece Kernel, Driver, Server ou Dashboard

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Executa handlers de forma segura.
 * Falhas são isoladas e ignoradas.
 */
function safeCall(handler, payload) {
    try {
        handler(payload);
    } catch (_) {
        // transporte nunca falha semanticamente
    }
}

/* ===========================
   Fábrica da conexão
=========================== */

/**
 * Cria uma conexão física genérica.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 *
 * @param {Object} deps.adapter
 * Adaptador físico concreto (ex.: IPC, socket, pipe).
 * Deve expor:
 *  - start()
 *  - stop()
 *  - send(frame)
 *  - onReceive(handler)
 *  - onError(handler) [opcional]
 */
function createConnection({ telemetry, adapter }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('connection requer telemetry válida');
    }

    if (!adapter) {
        throw new Error('connection requer adapter físico');
    }

    const receiveHandlers = new Set();
    let started = false;

    /* ===========================
     Conexões internas
  =========================== */

    if (typeof adapter.onReceive === 'function') {
        adapter.onReceive(frame => {
            telemetry.emit('nerv:transport:receive', {
                size: frame ? frame.length || null : null
            });

            for (const handler of receiveHandlers) {
                safeCall(handler, frame);
            }
        });
    }

    if (typeof adapter.onError === 'function') {
        adapter.onError(error => {
            telemetry.emit('nerv:transport:error', {
                message: error ? error.message : 'erro físico'
            });
        });
    }

    /* ===========================
     API pública do módulo
  =========================== */

    /**
     * Inicializa a conexão física.
     */
    function start() {
        if (started) {
            return;
        }

        started = true;
        telemetry.emit('nerv:transport:start');

        if (typeof adapter.start === 'function') {
            adapter.start();
        }

        telemetry.emit('nerv:transport:connected');
    }

    /**
     * Encerra a conexão física.
     */
    function stop() {
        if (!started) {
            return;
        }

        started = false;
        telemetry.emit('nerv:transport:stop');

        if (typeof adapter.stop === 'function') {
            adapter.stop();
        }

        telemetry.emit('nerv:transport:disconnected');
    }

    /**
     * Envia frame opaco pelo meio físico.
     *
     * @param {*} frame
     */
    function send(frame) {
        telemetry.emit('nerv:transport:send', {
            size: frame ? frame.length || null : null
        });

        if (typeof adapter.send === 'function') {
            adapter.send(frame);
        }
    }

    /**
     * Registra handler de recepção de frames.
     *
     * @param {Function} handler
     */
    function onReceive(handler) {
        if (typeof handler !== 'function') {
            throw new Error('onReceive requer função');
        }

        receiveHandlers.add(handler);

        return () => {
            receiveHandlers.delete(handler);
        };
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        start,
        stop,
        send,
        onReceive
    });
}

module.exports = createConnection;
