// @ts-check
import { MessageType } from '#shared/nerv/constants';
import { getCorrelationId } from '#shared/nerv/envelope_reader';

/* ===========================
   Fábrica do emissor de ACK
=========================== */

/**
 * @typedef {object} CreateEmitAckDeps
 * @property {any} envelopes
 * @property {any} buffers
 * @property {any} correlation
 * @property {any} telemetry
 */
/**
 * @typedef {object} CreateEmitAckOptions
 * @property {*} [envelopes]
 * @property {*} [buffers]
 * @property {*} [correlation]
 * @property {*} [telemetry]
 */
/**
 * Cria o emissor técnico de ACKs.
 *
 * **Side-effects:** Registra emissão na correlação histórica.
 * **Semântica:** Emissor especializado para acknowledgments NERV.
 * **Unidades:** Envelopes seguem typedef NERV, correlação por correlation_id.
 *
 * @param {CreateEmitAckDeps} deps - Dependências do emissor
 * @returns {object} Emissor com método emitAck
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
 */
function createEmitAck({ envelopes, buffers, correlation, telemetry }) {
    if (!envelopes || !buffers || !correlation || !telemetry) {
        throw new Error('emit_ack requer dependências completas');
    }

    /* ===========================
     Operação de emissão
  =========================== */

    /**
     * Emite um envelope ACK técnico.
     *
     * @param {object} envelope
     * Envelope estruturalmente válido do tipo ACK.
     */
    function emitAck(envelope) {
        telemetry.emit('nerv:emission:attempt', {
            kind: MessageType.ACK,
        });

        let normalized;

        try {
            // 1. Normalização estrutural
            normalized = envelopes.normalize(envelope);

            // 2. Validação estrutural
            envelopes.assertValid(normalized);
        } catch (error) {
            const _e = /** @type {any} */ (error);
            telemetry.emit('nerv:emission:rejected', {
                kind: MessageType.ACK,
                reason: 'estrutura',
                message: _e.message,
            });
            return;
        }

        // 3. Registro histórico (ACK também é fato)
        const correlationId = getCorrelationId(normalized);
        if (correlationId) correlation.append(correlationId, normalized);

        // 4. Enfileiramento outbound
        const accepted = buffers.enqueueOutbound(normalized);

        if (!accepted) {
            telemetry.emit('nerv:emission:enqueue_failed', {
                kind: MessageType.ACK,
            });
            return;
        }

        // 5. Telemetria de sucesso técnico
        telemetry.emit('nerv:emission:success', {
            kind: MessageType.ACK,
        });
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        emitAck,
    });
}

export default createEmitAck;
