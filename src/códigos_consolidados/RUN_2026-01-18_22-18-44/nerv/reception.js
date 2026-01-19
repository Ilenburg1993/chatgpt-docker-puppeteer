FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\reception\reception.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/reception/reception.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: reception/
   Arquivo: reception.js

   Papel:
   - Compor o módulo de recepção do NERV
   - Expor interface mínima e neutra de entrada de fatos
   - Encapsular a recepção bruta e notificação de handlers

   IMPORTANTE:
   - NÃO interpreta payload
   - NÃO decide consequências
   - NÃO aciona Kernel ou Driver
   - NÃO gera ACK automaticamente
   - NÃO bloqueia fluxo
   - Atua apenas como fronteira factual

   Linguagem: JavaScript (Node.js)
========================================================================== */

const createReceive = require('./receive');

/* ===========================
   Fábrica do módulo reception
=========================== */

/**
 * Cria o módulo de recepção do NERV.
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
function createReception({
  envelopes,
  correlation,
  telemetry
}) {
  if (!envelopes || !correlation || !telemetry) {
    throw new Error('reception requer dependências completas');
  }

  /* =========================================================
     Composição do receptor factual
  ========================================================= */

  const receiver = createReceive({
    envelopes,
    correlation,
    telemetry
  });

  /* =========================================================
     Interface pública do módulo
  ========================================================= */

  return Object.freeze({
    /**
     * Recebe um frame inbound já desserializado.
     * Ato puramente factual.
     */
    receive: receiver.receive,

    /**
     * Registra handler para envelopes recebidos.
     */
    onReceive: receiver.onReceive
  });
}

module.exports = createReception;
