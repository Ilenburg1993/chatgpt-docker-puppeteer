/* ==========================================================================
   src/nerv/buffers/backpressure.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: buffers/
   Arquivo: backpressure.js

   Papel:
   - Centralizar a sinalização técnica de backpressure
   - Padronizar eventos de pressão de filas
   - Tornar visível o estado físico do fluxo

   IMPORTANTE:
   - NÃO bloqueia execução
   - NÃO decide descarte
   - NÃO altera fluxo
   - NÃO interpreta causa ou consequência
   - Atua apenas como observador técnico

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Fábrica do backpressure
=========================== */

/**
 * Cria um observador técnico de backpressure.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 */
function createBackpressure({ telemetry }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('backpressure requer telemetry válida');
    }

    /**
   * Emite sinal técnico de pressão.
   *
   * @param {Object} info
   * @param {string} info.buffer
   * Nome do buffer (ex.: inbound, outbound)
   *
   * @param {number} info.size
   * Tamanho atual da fila
   *
   * @param {number|null} info.limit
   * Limite técnico configurado
   */
    function signal({ buffer, size, limit }) {
        telemetry.emit('nerv:buffer:pressure', {
            buffer,
            size,
            limit
        });
    }

    /**
   * Emite sinal técnico de normalização (pressão aliviada).
   */
    function relief({ buffer, size }) {
        telemetry.emit('nerv:buffer:relief', {
            buffer,
            size
        });
    }

    return Object.freeze({
        signal,
        relief
    });
}

module.exports = createBackpressure;