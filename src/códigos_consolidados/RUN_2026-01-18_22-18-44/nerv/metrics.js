FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\telemetry\metrics.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/telemetry/metrics.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: telemetry/
   Arquivo: metrics.js

   Papel:
   - Fornecer estruturas técnicas para coleta de métricas
   - Padronizar contadores, gauges e timestamps
   - Oferecer snapshots imutáveis para leitura externa

   IMPORTANTE:
   - NÃO emite eventos
   - NÃO interfere em fluxo
   - NÃO decide
   - NÃO interpreta significado
   - NÃO depende de Kernel, Driver ou Server

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
 * Cria um objeto sem protótipo para evitar colisões.
 */
function emptyMap() {
  return Object.create(null);
}

/* ===========================
   Fábrica de métricas
=========================== */

/**
 * Cria um repositório técnico de métricas.
 *
 * @returns {Object}
 * Estrutura contendo operações puramente técnicas.
 */
function createMetrics() {
  const counters = emptyMap();
  const gauges = emptyMap();
  const timestamps = emptyMap();

  /* ===========================
     Operações internas
  =========================== */

  function incCounter(name, value = 1) {
    counters[name] = (counters[name] || 0) + value;
  }

  function setGauge(name, value) {
    gauges[name] = value;
  }

  function mark(name) {
    timestamps[name] = now();
  }

  /* ===========================
     Leitura (snapshot)
  =========================== */

  function snapshot() {
    return {
      counters: { ...counters },
      gauges: { ...gauges },
      timestamps: { ...timestamps }
    };
  }

  function reset() {
    for (const k in counters) delete counters[k];
    for (const k in gauges) delete gauges[k];
    for (const k in timestamps) delete timestamps[k];
  }

  /* ===========================
     Exportação técnica
  =========================== */

  return Object.freeze({
    incCounter,
    setGauge,
    mark,
    snapshot,
    reset
  });
}

module.exports = createMetrics;
