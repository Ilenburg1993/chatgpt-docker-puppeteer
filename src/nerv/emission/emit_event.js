// @ts-check
import { MessageType } from '#shared/nerv/constants';
import { getCorrelationId } from '#shared/nerv/envelope_reader';

/* ===========================
   Fábrica do emissor de EVENT
=========================== */

/**
 * @typedef {object} CreateEmitEventDeps
 * @property {any} envelopes
 * @property {any} buffers
 * @property {any} correlation
 * @property {any} telemetry
 */
/**
 * @typedef {object} CreateEmitEventOptions
 * @property {*} [envelopes]
 * @property {*} [buffers]
 * @property {*} [correlation]
 * @property {*} [telemetry]
 */
/**
 * Cria o emissor técnico de EVENTs.
 *
 * **Side-effects:** Registra emissão na correlação histórica.
 * **Semântica:** Emissor especializado para mensagens de evento NERV.
 * **Unidades:** Envelopes seguem typedef NERV, correlação por correlation_id.
 *
 * @param {CreateEmitEventDeps} deps - Dependências do emissor
 * @returns {object} Emissor com método emitEvent
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
 */
function createEmitEvent({ envelopes, buffers, correlation, telemetry }) {
    if (!envelopes || !buffers || !correlation || !telemetry) {
        throw new Error('emit_event requer dependências completas');
    }

    /* ===========================
     Operação de emissão
  =========================== */

    /**
     * Emite um envelope EVENT.
     *
     * @param {object} envelope
     * Envelope estruturalmente válido.
     */
    function emitEvent(envelope) {
        telemetry.emit('nerv:emission:attempt', {
            kind: MessageType.EVENT,
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
                kind: MessageType.EVENT,
                reason: 'estrutura',
                message: _e.message,
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
                kind: MessageType.EVENT,
            });
            return;
        }

        // 5. Telemetria de sucesso técnico
        telemetry.emit('nerv:emission:success', {
            kind: MessageType.EVENT,
        });
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        emitEvent,
    });
}

export default createEmitEvent;
