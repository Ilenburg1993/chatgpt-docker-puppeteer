// @ts-check - Type checking rigoroso habilitado (arquivo core)
import createConnection from './connection.js';
import * as framing from './framing.js';
import createReconnect from './reconnect.js';

/* ===========================
   Fábrica do transporte
=========================== */

/**
 * @typedef {object} CreateTransportDeps
 * @property {object} telemetry
 * @property {object} adapter
 */
/**
 * @typedef {object} CreateTransportOptions
 * @property {*} [telemetry]
 * @property {*} [adapter]
 * @property {*} [reconnect]
 */
/**
 * Cria o subsistema de transporte físico do NERV.
 *
 * **Side-effects:** Inicializa framing, conexão e reconexão automática.
 * **Semântica:** Composição completa do plano físico de comunicação.
 * **Unidades:** Políticas de reconexão seguem typedef de createReconnect.
 *
 * @param {CreateTransportDeps} deps - Dependências do transporte
 * @param {object} deps.telemetry - Interface de telemetria do NERV
 * @param {object} deps.adapter - Adaptador físico (IPC, socket, pipe)
 * @param {object} [deps.reconnect] - Política de reconexão opcional
 * @param {CreateTransportOptions} [options]
 * @returns {object} Transporte com métodos send, start, stop, onReceive
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
 */
function createTransport({ telemetry, adapter, reconnect: reconnectPolicy }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('transport requer telemetry válida');
    }

    if (!adapter) {
        throw new Error('transport requer adapter físico');
    }

    /* =========================================================
     1. Framing (empacotamento físico)
  ========================================================= */

    const unpacker = framing.createUnpacker();

    /* =========================================================
     2. Conexão física
  ========================================================= */

    const connection = createConnection({
        telemetry,
        adapter: {
            ...adapter,

            // Recebe chunks brutos do meio físico
            onReceive(handler) {
                adapter.onReceive(chunk => {
                    unpacker.push(chunk, handler);
                });
            },
        },
    });

    /* =========================================================
     3. Reconexão técnica (opcional)
  ========================================================= */

    const reconnect = reconnectPolicy
        ? createReconnect({
              telemetry,
              start: connection.start,
              stop: connection.stop,
              policy: reconnectPolicy,
          })
        : null;

    /* =========================================================
     4. API pública do transporte
  ========================================================= */

    /**
     * Inicializa o transporte físico.
     */
    function start() {
        telemetry.emit('nerv:transport:starting');
        connection.start();
    }

    /**
     * Encerra o transporte físico.
     */
    function stop() {
        telemetry.emit('nerv:transport:stopping');

        if (reconnect) {
            reconnect.stop();
        }

        connection.stop();
    }

    /**
     * Envia frame opaco pelo meio físico.
     *
     * @param {Buffer|Uint8Array} frame
     */
    function send(frame) {
        const packed = framing.pack(frame);
        connection.send(packed);
    }

    /**
     * Registra handler para frames recebidos.
     *
     * @param {function} handler
     */
    function onReceive(handler) {
        connection.onReceive(handler);
    }

    /* =========================================================
     Exportação canônica
  ========================================================= */

    return Object.freeze({
        start,
        stop,
        send,
        onReceive,
    });
}

export default createTransport;
