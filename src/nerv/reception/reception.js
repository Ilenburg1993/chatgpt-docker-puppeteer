import createReceive from './receive.js';

/* ===========================
   Fábrica do módulo reception
=========================== */

/**
 * Cria o módulo de recepção do NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.envelopes
 * Sistema de envelopes (normalização + validação estrutural).
 *
 * @param {Object} deps.correlation
 * Sistema de correlação histórica.
 *
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 */
function createReception({ envelopes, correlation, telemetry }) {
    if (!envelopes || !correlation || !telemetry) {
        throw new Error('reception requer dependências completas');
    }

    /* =========================================================
     Composição do receptor factual
  ========================================================= */

    const receiver = createReceive({
        envelopes,
        correlation,
        telemetry
    });

    /* =========================================================
     Interface pública do módulo
  ========================================================= */

    return Object.freeze({
        /**
         * Recebe um frame inbound já desserializado.
         * Ato puramente factual.
         */
        receive: receiver.receive,

        /**
         * Registra handler para envelopes recebidos.
         */
        onReceive: receiver.onReceive
    });
}

export default createReception;
