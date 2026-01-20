/* ==========================================================================
   src/nerv/transport/transport.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: transport/
   Arquivo: transport.js

   Papel:
   - Compor o subsistema de transporte físico do NERV
   - Conectar framing, conexão e reconexão
   - Expor interface técnica mínima ao NERV

   IMPORTANTE:
   - NÃO interpreta frames
   - NÃO valida envelopes
   - NÃO decide retry lógico
   - NÃO garante entrega
   - NÃO conhece Kernel, Driver ou Server
   - Atua exclusivamente no plano físico

   Linguagem: JavaScript (Node.js)
========================================================================== */

const createConnection = require('./connection');
const createReconnect = require('./reconnect');
const framing = require('./framing');

/* ===========================
   Fábrica do transporte
=========================== */

/**
 * Cria o subsistema de transporte físico do NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 *
 * @param {Object} deps.adapter
 * Adaptador físico concreto (IPC, socket, pipe etc).
 *
 * @param {Object} [deps.reconnect]
 * Política técnica opcional de reconexão.
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
        adapter.onReceive((chunk) => {
          unpacker.push(chunk, handler);
        });
      }
    }
  });

  /* =========================================================
     3. Reconexão técnica (opcional)
  ========================================================= */

  const reconnect = reconnectPolicy
    ? createReconnect({
        telemetry,
        start: connection.start,
        stop: connection.stop,
        policy: reconnectPolicy
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
   * @param {Function} handler
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
    onReceive
  });
}

module.exports = createTransport;
