// @ts-check
import createReceive from './receive.js';

/* ===========================
   Fábrica do módulo reception
=========================== */

/**
 * @typedef {object} CreateReceptionDeps
 * @property {any} envelopes
 * @property {any} correlation
 * @property {any} telemetry
 */
/**
 * @typedef {object} CreateReceptionOptions
 * @property {any} [envelopes]
 * @property {any} [correlation]
 * @property {any} [telemetry]
 */
/**
 * Cria o módulo de recepção do NERV.
 *
 * **Side-effects:** Inicializa receptor de mensagens e correlação histórica. **Semântica:** Composição de subsistemas
 * de recepção para comunicação neural. **Unidades:** Dependências seguem contratos NERV (envelopes, correlation,
 * telemetry).
 *
 * @param {CreateReceptionDeps} deps - Dependências do módulo
 * @returns {any} Módulo de recepção com método onMessage
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
 */
function createReception({ envelopes, correlation, telemetry }) {
    if (!envelopes || !correlation || !telemetry) {
        throw new Error('reception requer dependências completas');
    }

    /* =========================================================
     Composição do receptor factual
  ========================================================= */

    const receiver = /** @type {any} */ (
        createReceive({
            envelopes,
            correlation,
            telemetry,
        })
    );

    /* =========================================================
     Interface pública do módulo
  ========================================================= */

    return Object.freeze({
        /**
         * Recebe um frame inbound já desserializado. Ato puramente factual.
         */
        receive: receiver.receive,

        /**
         * Registra handler para envelopes recebidos.
         */
        onReceive: receiver.onReceive,
    });
}

export default createReception;
