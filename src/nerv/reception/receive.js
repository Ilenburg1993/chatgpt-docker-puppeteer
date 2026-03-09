// @ts-check
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

import { getCorrelationId, getMessageType } from '#shared/nerv/envelope_reader';

/**
 * Executa handlers de forma isolada. Falhas são capturadas e observadas.
 *
 * @param {Function} handler
 * @param {any} envelope
 * @param {any} telemetry
 */
function safeCall(handler, envelope, telemetry) {
    try {
        handler(envelope);
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        telemetry.emit('nerv:reception:handler_error', {
            message: _e.message,
        });
    }
}

/* ===========================
   Fábrica do receptor
=========================== */

/**
 * @typedef {object} CreateReceptionDeps
 * @property {any} envelopes
 * @property {any} correlation
 * @property {any} telemetry
 */
/**
 * @typedef {object} CreateReceptionOptions
 * @property {any} [envelopes]
 * @property {any} [correlation]
 * @property {any} [telemetry]
 */
/**
 * Cria o módulo de recepção bruta do NERV.
 *
 * **Side-effects:** Registra envelopes na correlação histórica, notifica handlers. **Semântica:** Receptor técnico que
 * processa frames inbound desserializados. **Unidades:** Envelopes seguem typedef NERV, correlação por correlation_id.
 *
 * @param {CreateReceptionDeps} deps - Dependências do receptor
 * @returns {any} Receptor com métodos onMessage, receive
 * @throws {Error} Se dependências obrigatórias estiverem ausentes
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
     * Recebe um frame inbound já desserializado (objeto bruto ou buffer convertido).
     *
     * @param {object} raw
     */
    function receive(raw) {
        telemetry.emit('nerv:reception:frame_received');

        let envelope;

        try {
            // 1. Desserialização técnica (se necessário)
            envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (/** @type {any} */ error) {
            const _e = /** @type {any} */ (error);
            telemetry.emit('nerv:reception:deserialization_failed', {
                message: _e.message,
            });
            return;
        }

        let normalized;

        try {
            // 2. Normalização estrutural
            normalized = envelopes.normalize(envelope);

            // 3. Validação estrutural
            envelopes.assertValid(normalized);
        } catch (/** @type {any} */ error) {
            const _e = /** @type {any} */ (error);
            telemetry.emit('nerv:reception:invalid_envelope', {
                message: _e.message,
            });
            return;
        }

        // 4. Registro histórico de correlação
        const correlationId = getCorrelationId(normalized);
        if (correlationId) correlation.append(correlationId, normalized);

        telemetry.emit('nerv:reception:accepted', {
            kind: getMessageType(normalized),
        });

        // 5. Notificação de handlers
        for (const handler of handlers) {
            safeCall(handler, normalized, telemetry);
        }
    }

    /**
     * Registra handler de recepção.
     *
     * @param {function} handler
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
        onReceive,
    });
}

export default createReception;
