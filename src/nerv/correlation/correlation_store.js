/* ==========================================================================
   src/nerv/correlation/correlation_store.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: correlation/
   Arquivo: correlation_store.js

   Papel:
   - Armazenar registros históricos correlacionados por correlation_id
   - Preservar ordem de chegada dos fatos
   - Permitir leitura e auditoria do histórico
   - Emitir telemetria técnica sobre crescimento e criação

   IMPORTANTE:
   - NÃO encerra correlação
   - NÃO decide sucesso/falha
   - NÃO deduz causalidade
   - NÃO descarta eventos por tempo lógico
   - NÃO interpreta payload

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Retorna timestamp técnico de chegada.
 */
function now() {
    return Date.now();
}

/**
 * Cria um mapa sem protótipo para evitar colisões.
 */
function emptyMap() {
    return Object.create(null);
}

/* ===========================
   Fábrica do store de correlação
=========================== */

/**
 * Cria o armazenamento histórico de correlações.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV (observação técnica).
 *
 * @param {Object} [deps.limits]
 * Limites técnicos opcionais (ex.: maxEntries por correlação).
 */
function createCorrelationStore({ telemetry, limits = {} }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('correlation_store requer telemetry válida');
    }

    const store = emptyMap();

    const MAX_ENTRIES =
    typeof limits.maxEntries === 'number' ? limits.maxEntries : null;

    /* ===========================
     Operações internas
  =========================== */

    /**
   * Cria uma nova correlação, se ainda não existir.
   */
    function ensureCorrelation(correlationId) {
        if (!store[correlationId]) {
            store[correlationId] = [];

            telemetry.emit('nerv:correlation:created', {
                correlation_id: correlationId
            });
        }
    }

    /**
   * Cria um registro técnico mínimo a partir de um envelope.
   * Payload permanece opaco (não armazenado integralmente).
   */
    function createRecord(envelope) {
        return Object.freeze({
            timestamp: now(),
            kind: envelope.kind,
            msg_id: envelope.ids ? envelope.ids.msg_id : null
        });
    }

    /* ===========================
     API pública do módulo
  =========================== */

    /**
   * Registra um envelope em sua correlação.
   *
   * @param {string} correlationId
   * @param {Object} envelope
   */
    function append(correlationId, envelope) {
        if (typeof correlationId !== 'string') {
            return;
        }

        ensureCorrelation(correlationId);

        const records = store[correlationId];
        records.push(createRecord(envelope));

        telemetry.emit('nerv:correlation:append', {
            correlation_id: correlationId,
            size: records.length
        });

        // Limite técnico opcional (não causal)
        if (MAX_ENTRIES && records.length > MAX_ENTRIES) {
            telemetry.emit('nerv:correlation:size_exceeded', {
                correlation_id: correlationId,
                size: records.length,
                limit: MAX_ENTRIES
            });
        }
    }

    /**
   * Retorna cópia do histórico de uma correlação.
   *
   * @param {string} correlationId
   * @returns {Array}
   */
    function get(correlationId) {
        if (!store[correlationId]) {
            return [];
        }

        return store[correlationId].slice();
    }

    /**
   * Verifica se uma correlação existe.
   *
   * @param {string} correlationId
   * @returns {boolean}
   */
    function has(correlationId) {
        return Boolean(store[correlationId]);
    }

    /**
   * Retorna o tamanho do histórico de uma correlação.
   *
   * @param {string} correlationId
   * @returns {number}
   */
    function size(correlationId) {
        if (!store[correlationId]) {
            return 0;
        }

        return store[correlationId].length;
    }

    /**
   * Lista todos os correlation_ids existentes.
   * Uso exclusivo para auditoria/diagnóstico.
   *
   * @returns {Array<string>}
   */
    function list() {
        return Object.keys(store);
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        append,
        get,
        has,
        size,
        list
    });
}

module.exports = createCorrelationStore;
