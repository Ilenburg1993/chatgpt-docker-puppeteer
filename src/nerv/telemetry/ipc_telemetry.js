/* ==========================================================================
   src/nerv/telemetry/ipc_telemetry.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: telemetry/
   Arquivo: ipc_telemetry.js

   Papel:
   - Registrar eventos técnicos do NERV
   - Coletar métricas de observabilidade
   - Expor subscrição passiva a eventos
   - Fornecer snapshots de métricas

   IMPORTANTE:
   - NÃO altera fluxo
   - NÃO bloqueia execução
   - NÃO decide
   - NÃO interpreta sucesso/falha
   - Falhas internas NÃO quebram o NERV

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Retorna timestamp atual em milissegundos.
 */
function now() {
  return Date.now();
}

/**
 * Garante execução segura de handlers de telemetria.
 * Qualquer erro é isolado e ignorado.
 */
function safeCall(handler, payload) {
  try {
    handler(payload);
  } catch (_) {
    // Falha silenciosa: telemetria nunca interfere
  }
}

/* ===========================
   Fábrica de telemetria
=========================== */

/**
 * Cria o sistema de telemetria do NERV.
 *
 * @param {Object} config
 * Configuração estritamente técnica (opcional):
 * - enabled: boolean
 */
function createIPCTelemetry(config = {}) {
  const enabled = config.enabled !== false;

  /* ===========================
     Estado interno (técnico)
  =========================== */

  const subscribers = new Set();

  const metrics = {
    counters: Object.create(null),
    gauges: Object.create(null),
    timestamps: Object.create(null)
  };

  /* ===========================
     Funções internas
  =========================== */

  /**
   * Incrementa contador técnico.
   */
  function incCounter(name, value = 1) {
    metrics.counters[name] = (metrics.counters[name] || 0) + value;
  }

  /**
   * Atualiza gauge técnico.
   */
  function setGauge(name, value) {
    metrics.gauges[name] = value;
  }

  /**
   * Registra timestamp técnico.
   */
  function mark(name) {
    metrics.timestamps[name] = now();
  }

  /* ===========================
     API pública do módulo
  =========================== */

  /**
   * Emite um evento técnico de telemetria.
   *
   * @param {string} type
   * Nome do evento técnico (ex.: nerv:envelope:sent)
   *
   * @param {Object} [meta]
   * Metadados técnicos opcionais (nunca semânticos)
   */
  function emit(type, meta = null) {
    if (!enabled) return;

    const event = {
      timestamp: now(),
      type,
      meta: meta || undefined
    };

    // Atualizações internas de métricas (não causais)
    incCounter(`event:${type}`);
    mark(`last:${type}`);

    // Notifica subscritores de forma isolada
    for (const handler of subscribers) {
      safeCall(handler, event);
    }
  }

  /**
   * Subscrição passiva a eventos de telemetria.
   *
   * @param {Function} handler
   */
  function on(handler) {
    if (typeof handler !== 'function') {
      throw new Error('telemetry.on requer função');
    }

    subscribers.add(handler);

    // Retorna função de unsubscribe (opcional)
    return () => {
      subscribers.delete(handler);
    };
  }

  /**
   * Retorna snapshot das métricas atuais.
   * Leitura pura, sem efeitos colaterais.
   */
  function stats() {
    return {
      counters: { ...metrics.counters },
      gauges: { ...metrics.gauges },
      timestamps: { ...metrics.timestamps }
    };
  }

  /**
   * Reseta métricas internas.
   * Uso permitido apenas para testes.
   */
  function reset() {
    metrics.counters = Object.create(null);
    metrics.gauges = Object.create(null);
    metrics.timestamps = Object.create(null);
  }

  /* ===========================
     Exportação do módulo
  =========================== */

  return Object.freeze({
    emit,
    on,
    stats,
    reset,

    // APIs técnicas opcionais para outros módulos
    _incCounter: incCounter,
    _setGauge: setGauge,
    _mark: mark
  });
}

module.exports = createIPCTelemetry;
