/* ==========================================================================
   src/nerv/correlation/correlation_context.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: correlation/
   Arquivo: correlation_context.js

   Papel:
   - Fornecer uma camada de CONTEXTO DE LEITURA sobre correlações
   - Facilitar inspeção, auditoria e observabilidade
   - Preservar causalidade aberta (sem encerramento, sem decisão)

   IMPORTANTE:
   - NÃO armazena dados (isso é papel do correlation_store)
   - NÃO interpreta eventos
   - NÃO decide sucesso/falha
   - NÃO encerra correlações
   - NÃO deduz causalidade
   - NÃO influencia fluxo do NERV

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Verifica se valor é string não vazia.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Clona array de registros de forma segura.
 */
function cloneRecords(records) {
  return Array.isArray(records) ? records.slice() : [];
}

/* ===========================
   Fábrica do contexto de correlação
=========================== */

/**
 * Cria o contexto de leitura de correlações.
 *
 * @param {Object} deps
 * @param {Object} deps.store
 * Instância de correlation_store (armazenamento histórico).
 *
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV (observação técnica).
 */
function createCorrelationContext({ store, telemetry }) {
  if (!store) {
    throw new Error('correlation_context requer store válido');
  }

  if (!telemetry || typeof telemetry.emit !== 'function') {
    throw new Error('correlation_context requer telemetry válida');
  }

  /* ===========================
     Operações de leitura
  =========================== */

  /**
   * Retorna o histórico completo de uma correlação.
   *
   * @param {string} correlationId
   * @returns {Array<Object>}
   */
  function getHistory(correlationId) {
    if (!isNonEmptyString(correlationId)) {
      return [];
    }

    const history = cloneRecords(store.get(correlationId));

    telemetry.emit('nerv:correlation:read', {
      correlation_id: correlationId,
      size: history.length
    });

    return history;
  }

  /**
   * Verifica se uma correlação existe.
   *
   * @param {string} correlationId
   * @returns {boolean}
   */
  function exists(correlationId) {
    if (!isNonEmptyString(correlationId)) {
      return false;
    }

    return store.has(correlationId);
  }

  /**
   * Retorna o tamanho do histórico de uma correlação.
   *
   * @param {string} correlationId
   * @returns {number}
   */
  function size(correlationId) {
    if (!isNonEmptyString(correlationId)) {
      return 0;
    }

    return store.size(correlationId);
  }

  /**
   * Retorna lista de todas as correlações existentes.
   * Uso exclusivo para auditoria/diagnóstico.
   *
   * @returns {Array<string>}
   */
  function list() {
    const ids = store.list();

    telemetry.emit('nerv:correlation:list', {
      count: ids.length
    });

    return ids.slice();
  }

  /* ===========================
     Exportação canônica
  =========================== */

  return Object.freeze({
    getHistory,
    exists,
    size,
    list
  });
}

module.exports = createCorrelationContext;
