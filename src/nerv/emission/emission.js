// @ts-check - Type checking rigoroso habilitado (arquivo core)
import createEmitCommand from './emit_command.js';
import createEmitEvent from './emit_event.js';
import createEmitAck from './emit_ack.js';

/* ===========================
   Fábrica do módulo emission
=========================== */

/**
 * Cria o módulo de emissão do NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.envelopes
 * Sistema de envelopes (normalização + validação estrutural).
 *
 * @param {Object} deps.buffers
 * Subsistema de buffers (fila outbound).
 *
 * @param {Object} deps.correlation
 * Sistema de correlação histórica.
 *
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
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
        telemetry
    });

    const eventEmitter = createEmitEvent({
        envelopes,
        buffers,
        correlation,
        telemetry
    });

    const ackEmitter = createEmitAck({
        envelopes,
        buffers,
        correlation,
        telemetry
    });

    /* =========================================================
     Interface pública do módulo
  ========================================================= */

    return Object.freeze({
        emitCommand: commandEmitter.emitCommand,
        emitEvent: eventEmitter.emitEvent,
        emitAck: ackEmitter.emitAck
    });
}

export default createEmission;
