/* ==========================================================================
   src/nerv/emission/emit_ack.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: emission/
   Arquivo: emit_ack.js

   Papel:
   - Emitir envelopes do tipo ACK de forma PURAMENTE TÉCNICA
   - Registrar confirmação de RECEBIMENTO FÍSICO
   - Nunca fechar causalidade nem indicar sucesso lógico

   IMPORTANTE:
   - ACK NÃO é resposta semântica
   - ACK NÃO encerra correlação
   - ACK NÃO garante entrega
   - ACK NÃO indica sucesso
   - ACK NÃO altera fluxo do sistema

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Fábrica do emissor de ACK
=========================== */

/**
 * Cria o emissor técnico de ACKs.
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
function createEmitAck({
    envelopes,
    buffers,
    correlation,
    telemetry
}) {
    if (!envelopes || !buffers || !correlation || !telemetry) {
        throw new Error('emit_ack requer dependências completas');
    }

    /* ===========================
     Operação de emissão
  =========================== */

    /**
   * Emite um envelope ACK técnico.
   *
   * @param {Object} envelope
   * Envelope estruturalmente válido do tipo ACK.
   */
    function emitAck(envelope) {
        telemetry.emit('nerv:emission:attempt', {
            kind: 'ACK'
        });

        let normalized;

        try {
            // 1. Normalização estrutural
            normalized = envelopes.normalize(envelope);

            // 2. Validação estrutural
            envelopes.assertValid(normalized);
        } catch (error) {
            telemetry.emit('nerv:emission:rejected', {
                kind: 'ACK',
                reason: 'estrutura',
                message: error.message
            });
            return;
        }

        // 3. Registro histórico (ACK também é fato)
        if (normalized.ids && normalized.ids.correlation_id) {
            correlation.append(
                normalized.ids.correlation_id,
                normalized
            );
        }

        // 4. Enfileiramento outbound
        const accepted = buffers.enqueueOutbound(normalized);

        if (!accepted) {
            telemetry.emit('nerv:emission:enqueue_failed', {
                kind: 'ACK'
            });
            return;
        }

        // 5. Telemetria de sucesso técnico
        telemetry.emit('nerv:emission:success', {
            kind: 'ACK'
        });
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        emitAck
    });
}

module.exports = createEmitAck;
