FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\nerv.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/NERV.js
   Subsistema: NERV — Neural Event Relay Vector
   Arquivo: NERV.js

   Estatuto:
   - COMPOSITOR ESTRUTURAL PURO
   - NÃO executa fluxo
   - NÃO registra callbacks internos
   - NÃO drena buffers
   - NÃO reage a eventos
   - NÃO decide
   - NÃO interpreta

   Este arquivo apenas CONSTRÓI e EXPÕE o NERV.
========================================================================== */

/* ===========================
   Imports canônicos
=========================== */

// Núcleo estrutural
const createEnvelopes = require('./envelopes/envelopes');
const createCorrelation = require('./correlation/correlation_store');
const createTelemetry = require('./telemetry/ipc_telemetry');

// Infraestrutura
const createBuffers = require('./buffers/buffers');
const createTransport = require('./transport/transport');

// Fronteiras semânticas neutras
const createEmission = require('./emission/emission');
const createReception = require('./reception/reception');
const createHealth = require('./health/health');

/* ===========================
   Fábrica do NERV
=========================== */

/**
 * Cria o subsistema NERV.
 *
 * @param {Object} config
 * Configurações estruturais:
 * - transport: { adapter, reconnect? }
 * - buffers: { inbound?, outbound? }
 * - health: { thresholds? }
 */
function createNERV(config = {}) {
  /* =========================================================
     1. Telemetria (base observacional)
  ========================================================= */

  const telemetry = createTelemetry({
    namespace: 'nerv'
  });

  /* =========================================================
     2. Envelopes (forma e validação estrutural)
  ========================================================= */

  const envelopes = createEnvelopes();

  /* =========================================================
     3. Correlação (histórico factual)
  ========================================================= */

  const correlation = createCorrelation();

  /* =========================================================
     4. Buffers (FIFO técnico)
  ========================================================= */

  const buffers = createBuffers({
    telemetry,
    limits: config.buffers || {}
  });

  /* =========================================================
     5. Transporte físico
  ========================================================= */

  if (!config.transport || !config.transport.adapter) {
    throw new Error('NERV requer transport.adapter');
  }

  const transport = createTransport({
    telemetry,
    adapter: config.transport.adapter,
    reconnect: config.transport.reconnect
  });

  /* =========================================================
     6. Emissão (ato unilateral)
  ========================================================= */

  const emission = createEmission({
    envelopes,
    buffers,
    correlation,
    telemetry
  });

  /* =========================================================
     7. Recepção (fronteira factual)
  ========================================================= */

  const reception = createReception({
    envelopes,
    correlation,
    telemetry
  });

  /* =========================================================
     8. Health (observação de vitalidade)
  ========================================================= */

  const health = createHealth({
    telemetry,
    thresholds: config.health?.thresholds || {}
  });

  /* =========================================================
     9. Interface pública do NERV
  ========================================================= */

  return Object.freeze({
    /* Emissão */
    emitCommand: emission.emitCommand,
    emitEvent: emission.emitEvent,
    emitAck: emission.emitAck,

    /* Recepção */
    receive: reception.receive,
    onReceive: reception.onReceive,

    /* Buffers (exposição explícita; sem auto-drain) */
    buffers,

    /* Transporte (controle externo) */
    transport,

    /* Health (observação) */
    health,

    /* Telemetria (observação avançada) */
    telemetry
  });
}

module.exports = createNERV;
