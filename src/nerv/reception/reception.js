// @ts-check - Type checking rigoroso habilitado (arquivo core)
import createReceive from './receive.js';

/* ===========================
   Fábrica do módulo reception
=========================== */

/**
 * @typedef {object} CreateReceptionDeps
 * @property {object} envelopes
 * @property {object} correlation
 * @property {object} telemetry
 */
/**
 * @typedef {object} CreateReceptionOptions
 * @property {*} [envelopes]
 * @property {*} [correlation]
 * @property {*} [telemetry]
 */
/**
 * Cria o módulo de recepção do NERV.
 *
 * **Side-effects:** Inicializa receptor de mensagens e correlação histórica.
 * **Semântica:** Composição de subsistemas de recepção para comunicação neural.
 * **Unidades:** Dependências seguem contratos NERV (envelopes, correlation, telemetry).
 *
 * @param {CreateReceptionDeps} deps - Dependências do módulo
 * @param {object} deps.envelopes - Sistema de envelopes (normalização + validação)
 * @param {object} deps.correlation - Sistema de correlação histórica
 * @param {object} deps.telemetry - Interface de telemetria do NERV
 * @param {CreateReceptionOptions} [options]
 * @returns {object} Módulo de recepção com método onMessage
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
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
        telemetry,
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
        onReceive: receiver.onReceive,
    });
}

export default createReception;
