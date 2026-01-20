/* ==========================================================================
   src/nerv/reception/receive.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: reception/
   Arquivo: receive.js

   Papel:
   - Receber frames inbound já reconstruídos
   - Desserializar e normalizar envelopes
   - Validar apenas a ESTRUTURA
   - Registrar fatos recebidos
   - Notificar handlers de forma isolada

   IMPORTANTE:
   - NÃO interpreta payload
   - NÃO decide consequências
   - NÃO gera ACK automaticamente
   - NÃO aciona Kernel ou Driver
   - NÃO bloqueia o fluxo

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Executa handlers de forma isolada.
 * Falhas são capturadas e observadas.
 */
function safeCall(handler, envelope, telemetry) {
    try {
        handler(envelope);
    } catch (error) {
        telemetry.emit('nerv:reception:handler_error', {
            message: error.message
        });
    }
}

/* ===========================
   Fábrica do receptor
=========================== */

/**
 * Cria o módulo de recepção bruta do NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.envelopes
 * Sistema de envelopes (normalização + validação estrutural).
 *
 * @param {Object} deps.correlation
 * Sistema de correlação histórica.
 *
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 */
function createReception({ envelopes, correlation, telemetry }) {
    if (!envelopes || !correlation || !telemetry) {
        throw new Error('reception requer dependências completas');
    }

    const handlers = new Set();

    /* ===========================
     Operação principal
  =========================== */

    /**
     * Recebe um frame inbound já desserializado
     * (objeto bruto ou buffer convertido).
     *
     * @param {*} raw
     */
    function receive(raw) {
        telemetry.emit('nerv:reception:frame_received');

        let envelope;

        try {
            // 1. Desserialização técnica (se necessário)
            envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (error) {
            telemetry.emit('nerv:reception:deserialization_failed', {
                message: error.message
            });
            return;
        }

        let normalized;

        try {
            // 2. Normalização estrutural
            normalized = envelopes.normalize(envelope);

            // 3. Validação estrutural
            envelopes.assertValid(normalized);
        } catch (error) {
            telemetry.emit('nerv:reception:invalid_envelope', {
                message: error.message
            });
            return;
        }

        // 4. Registro histórico de correlação
        if (normalized.ids && normalized.ids.correlation_id) {
            correlation.append(normalized.ids.correlation_id, normalized);
        }

        telemetry.emit('nerv:reception:accepted', {
            kind: normalized.kind
        });

        // 5. Notificação de handlers
        for (const handler of handlers) {
            safeCall(handler, normalized, telemetry);
        }
    }

    /**
     * Registra handler de recepção.
     *
     * @param {Function} handler
     */
    function onReceive(handler) {
        if (typeof handler !== 'function') {
            throw new Error('handler de recepção deve ser função');
        }

        handlers.add(handler);

        return () => {
            handlers.delete(handler);
        };
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        receive,
        onReceive
    });
}

module.exports = createReception;
