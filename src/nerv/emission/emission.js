// @ts-check
import createEmitAck from './emit_ack.js';
import createEmitCommand from './emit_command.js';
import createEmitEvent from './emit_event.js';

/* ===========================
   Fábrica do módulo emission
=========================== */

/**
 * @typedef {object} CreateEmissionDeps
 * @property {any} envelopes
 * @property {any} buffers
 * @property {any} correlation
 * @property {any} telemetry
 */
/**
 * @typedef {object} CreateEmissionOptions
 * @property {*} [envelopes]
 * @property {*} [buffers]
 * @property {*} [correlation]
 * @property {*} [telemetry]
 */
/**
 * Cria o módulo de emissão do NERV.
 *
 * **Side-effects:** Inicializa emissores de comandos, eventos e acknowledgments.
 * **Semântica:** Composição de subsistemas de emissão para comunicação neural.
 * **Unidades:** Dependências seguem contratos NERV (envelopes, buffers, correlation, telemetry).
 *
 * @param {CreateEmissionDeps} deps - Dependências do módulo
 * @returns {object} Módulo de emissão com métodos sendCommand, sendEvent, sendAck
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
 */
function createEmission({ envelopes, buffers, correlation, telemetry }) {
    if (!envelopes || !buffers || !correlation || !telemetry) {
        throw new Error('emission requer dependências completas');
    }

    /* =========================================================
     Composição dos emissores
  ========================================================= */

    const commandEmitter = /** @type {any} */ (
        createEmitCommand({
            envelopes,
            buffers,
            correlation,
            telemetry,
        })
    );

    const eventEmitter = /** @type {any} */ (
        createEmitEvent({
            envelopes,
            buffers,
            correlation,
            telemetry,
        })
    );

    const ackEmitter = /** @type {any} */ (
        createEmitAck({
            envelopes,
            buffers,
            correlation,
            telemetry,
        })
    );

    /* =========================================================
     Interface pública do módulo
  ========================================================= */

    return Object.freeze({
        emitCommand: commandEmitter.emitCommand,
        emitEvent: eventEmitter.emitEvent,
        emitAck: ackEmitter.emitAck,
    });
}

export default createEmission;
