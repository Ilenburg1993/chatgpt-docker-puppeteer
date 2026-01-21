/* ==========================================================================
   src/nerv/emission/emit_command.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: emission/
   Arquivo: emit_command.js

   Papel:
   - Emitir envelopes do tipo COMMAND de forma unilateral
   - Executar o pipeline técnico de saída do NERV
   - Registrar telemetria e correlação de forma observável

   IMPORTANTE:
   - NÃO cria envelopes
   - NÃO interpreta payload
   - NÃO espera resposta
   - NÃO decide retry
   - NÃO garante entrega
   - NÃO conhece Kernel, Driver ou política

   Linguagem: JavaScript (Node.js)
========================================================================== */

const { MessageType } = require('../../shared/nerv/constants');

/* ===========================
   Fábrica do emissor de COMMAND
=========================== */

/**
 * Cria o emissor técnico de COMMANDs.
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
     * @param {Object} envelope
     * Envelope estruturalmente válido.
     */
    function emitCommand(envelope) {
        telemetry.emit('nerv:emission:attempt', {
            kind: MessageType.COMMAND
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
                message: error.message
            });
            return;
        }

        // 3. Registro histórico de correlação
        if (normalized.ids && normalized.ids.correlation_id) {
            correlation.append(normalized.ids.correlation_id, normalized);
        }

        // 4. Enfileiramento outbound
        const accepted = buffers.enqueueOutbound(normalized);

        if (!accepted) {
            telemetry.emit('nerv:emission:enqueue_failed', {
                kind: MessageType.COMMAND
            });
            return;
        }

        // 5. Telemetria de sucesso técnico
        telemetry.emit('nerv:emission:success', {
            kind: MessageType.COMMAND
        });
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        emitCommand
    });
}

module.exports = createEmitCommand;
