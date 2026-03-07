// @ts-check
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
 * @typedef {object} CreateBackpressureDeps
 * @property {any} telemetry
 */
/**
 * @typedef {object} CreateBackpressureOptions
 * @property {*} [telemetry]
 */
/**
 * Cria um observador técnico de backpressure.
 *
 * @param {CreateBackpressureDeps} deps
 * Interface de telemetria do NERV.
 * @returns {any}
 */
function createBackpressure({ telemetry }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('backpressure requer telemetry válida');
    }

    /**
     * Emite sinal técnico de pressão.
     *
     * @param {{buffer: string, size: number, limit: number|null}} info
     */
    function signal({ buffer, size, limit }) {
        telemetry.emit('nerv:buffer:pressure', {
            buffer,
            size,
            limit,
        });
    }

    /**
     * Emite sinal técnico de normalização (pressão aliviada).
     * @param {{buffer: string, size: number}} info
     */
    function relief({ buffer, size }) {
        telemetry.emit('nerv:buffer:relief', {
            buffer,
            size,
        });
    }

    return Object.freeze({
        signal,
        relief,
    });
}

export default createBackpressure;
