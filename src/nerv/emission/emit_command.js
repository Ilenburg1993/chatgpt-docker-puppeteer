// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { MessageType } from '#shared/nerv/constants';
import { getCorrelationId } from '#shared/nerv/envelope_reader';

/* ===========================
   Fábrica do emissor de COMMAND
=========================== */

/**
 * @typedef {object} CreateEmitCommandDeps
 * @property {object} envelopes
 * @property {object} buffers
 * @property {object} correlation
 * @property {object} telemetry
 */
/**
 * @typedef {object} CreateEmitCommandOptions
 * @property {*} [envelopes]
 * @property {*} [buffers]
 * @property {*} [correlation]
 * @property {*} [telemetry]
 */
/**
 * Cria o emissor técnico de COMMANDs.
 *
 * **Side-effects:** Registra emissão na correlação histórica.
 * **Semântica:** Emissor especializado para mensagens de comando NERV.
 * **Unidades:** Envelopes seguem typedef NERV, correlação por correlation_id.
 *
 * @param {CreateEmitCommandDeps} deps - Dependências do emissor
 * @param {object} deps.envelopes - Sistema de envelopes (normalize, assertValid)
 * @param {object} deps.buffers - Subsistema de buffers outbound
 * @param {object} deps.correlation - Sistema de correlação histórica
 * @param {object} deps.telemetry - Interface de telemetria NERV
 * @param {CreateEmitCommandOptions} [options]
 * @returns {object} Emissor com método emitCommand
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
 */
function createEmitCommand({ envelopes, buffers, correlation, telemetry }) {
    if (!envelopes || !buffers || !correlation || !telemetry) {
        throw new Error('emit_command requer dependências completas');
    }

    /* ===========================
     Operação de emissão
  =========================== */

    /**
     * Emite um envelope COMMAND.
     *
     * @param {object} envelope
     * Envelope estruturalmente válido.
     */
    function emitCommand(envelope) {
        telemetry.emit('nerv:emission:attempt', {
            kind: MessageType.COMMAND,
        });

        let normalized;

        try {
            // 1. Normalização estrutural
            normalized = envelopes.normalize(envelope);

            // 2. Validação estrutural
            envelopes.assertValid(normalized);
        } catch (error) {
            telemetry.emit('nerv:emission:rejected', {
                kind: MessageType.COMMAND,
                reason: 'estrutura',
                message: error.message,
            });
            return;
        }

        // 3. Registro histórico de correlação
        const correlationId = getCorrelationId(normalized);
        if (correlationId) correlation.append(correlationId, normalized);

        // 4. Enfileiramento outbound
        const accepted = buffers.enqueueOutbound(normalized);

        if (!accepted) {
            telemetry.emit('nerv:emission:enqueue_failed', {
                kind: MessageType.COMMAND,
            });
            return;
        }

        // 5. Telemetria de sucesso técnico
        telemetry.emit('nerv:emission:success', {
            kind: MessageType.COMMAND,
        });
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        emitCommand,
    });
}

export default createEmitCommand;
