FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\emission\emission.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/emission/emission.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: emission/
   Arquivo: emission.js

   Papel:
   - Compor o módulo de emissão do NERV
   - Expor interface declarativa mínima para emissão
   - Encaminhar envelopes para o pipeline técnico correto

   IMPORTANTE:
   - NÃO cria envelopes
   - NÃO decide quando emitir
   - NÃO espera respostas
   - NÃO interpreta payload
   - NÃO garante entrega
   - NÃO conhece Kernel, Driver ou política

   Linguagem: JavaScript (Node.js)
========================================================================== */

const createEmitCommand = require('./emit_command');
const createEmitEvent = require('./emit_event');
const createEmitAck = require('./emit_ack');

/* ===========================
   Fábrica do módulo emission
=========================== */

/**
 * Cria o módulo de emissão do NERV.
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
function createEmission({
  envelopes,
  buffers,
  correlation,
  telemetry
}) {
  if (!envelopes || !buffers || !correlation || !telemetry) {
    throw new Error('emission requer dependências completas');
  }

  /* =========================================================
     Composição dos emissores
  ========================================================= */

  const commandEmitter = createEmitCommand({
    envelopes,
    buffers,
    correlation,
    telemetry
  });

  const eventEmitter = createEmitEvent({
    envelopes,
    buffers,
    correlation,
    telemetry
  });

  const ackEmitter = createEmitAck({
    envelopes,
    buffers,
    correlation,
    telemetry
  });

  /* =========================================================
     Interface pública do módulo
  ========================================================= */

  return Object.freeze({
    emitCommand: commandEmitter.emitCommand,
    emitEvent: eventEmitter.emitEvent,
    emitAck: ackEmitter.emitAck
  });
}

module.exports = createEmission;
