// @ts-check - Type checking rigoroso habilitado (arquivo core)
import createEmitAck from './emit_ack.js';
import createEmitCommand from './emit_command.js';
import createEmitEvent from './emit_event.js';

/* ===========================
   Fábrica do módulo emission
=========================== */

/**
 * Cria o módulo de emissão do NERV.
 *
 * **Side-effects:** Inicializa emissores de comandos, eventos e acknowledgments.
 * **Semântica:** Composição de subsistemas de emissão para comunicação neural.
 * **Unidades:** Dependências seguem contratos NERV (envelopes, buffers, correlation, telemetry).
 *
 * @param {object} deps - Dependências do módulo
 * @param {object} deps.envelopes - Sistema de envelopes (normalização + validação)
 * @param {object} deps.buffers - Subsistema de buffers (fila outbound)
 * @param {object} deps.correlation - Sistema de correlação histórica
 * @param {object} deps.telemetry - Interface de telemetria do NERV
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

    const commandEmitter = createEmitCommand({
        envelopes,
        buffers,
        correlation,
        telemetry,
    });

    const eventEmitter = createEmitEvent({
        envelopes,
        buffers,
        correlation,
        telemetry,
    });

    const ackEmitter = createEmitAck({
        envelopes,
        buffers,
        correlation,
        telemetry,
    });

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
