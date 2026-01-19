FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\envelopes\validator.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/envelopes/validator.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: envelopes/
   Arquivo: validator.js

   Papel:
   - Orquestrar a validação estrutural de envelopes
   - Tornar falhas estruturais observáveis via telemetria
   - Garantir que apenas envelopes FORMALMENTE válidos
     avancem no fluxo interno do NERV

   IMPORTANTE:
   - NÃO interpreta payload
   - NÃO classifica sucesso/falha lógica
   - NÃO toma decisões
   - NÃO corrige envelopes
   - NÃO conhece Kernel, Driver ou Server

   Linguagem: JavaScript (Node.js)
========================================================================== */

const {
  isValidEnvelope,
  assertValidEnvelope,
  PROTOCOL_VERSION
} = require('./schemas');

/* ===========================
   Fábrica do validador
=========================== */

/**
 * Cria um validador estrutural de envelopes.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV (observação técnica).
 */
function createEnvelopeValidator({ telemetry }) {
  if (!telemetry || typeof telemetry.emit !== 'function') {
    throw new Error('validator requer telemetry válida');
  }

  /**
   * Valida envelope de forma segura.
   * Não lança exceção — retorna booleano.
   */
  function validate(envelope) {
    const valid = isValidEnvelope(envelope);

    if (!valid) {
      telemetry.emit('nerv:envelope:invalid', {
        reason: 'estrutura',
        envelope_preview: previewEnvelope(envelope)
      });
    }

    return valid;
  }

  /**
   * Asserta validade estrutural.
   * Lança erro técnico se inválido.
   */
  function assert(envelope) {
    try {
      assertValidEnvelope(envelope);
    } catch (error) {
      telemetry.emit('nerv:envelope:rejected', {
        reason: 'estrutura',
        error: error.message,
        envelope_preview: previewEnvelope(envelope)
      });

      throw error;
    }
  }

  /**
   * Verifica compatibilidade de versão do protocolo.
   * NÃO decide upgrade/downgrade.
   */
  function checkProtocolVersion(envelope) {
    if (
      envelope &&
      envelope.header &&
      typeof envelope.header.version === 'number' &&
      envelope.header.version !== PROTOCOL_VERSION
    ) {
      telemetry.emit('nerv:envelope:protocol_mismatch', {
        expected: PROTOCOL_VERSION,
        received: envelope.header.version
      });
    }
  }

  /**
   * Produz uma visualização segura e parcial do envelope
   * para fins de observabilidade (sem payload).
   */
  function previewEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') {
      return null;
    }

    return {
      kind: envelope.kind,
      ids: envelope.ids || null,
      header: envelope.header
        ? {
            version: envelope.header.version,
            source: envelope.header.source,
            target: envelope.header.target || null
          }
        : null
    };
  }

  /* ===========================
     Interface pública do validador
  =========================== */

  return Object.freeze({
    validate,             // boolean
    assert,               // lança erro técnico
    checkProtocolVersion  // apenas observação
  });
}

/* ===========================
   Exportação canônica
=========================== */

module.exports = createEnvelopeValidator;
