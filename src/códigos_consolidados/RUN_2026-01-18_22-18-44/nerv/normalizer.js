FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\envelopes\normalizer.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/envelopes/normalizer.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: envelopes/
   Arquivo: normalizer.js

   Papel:
   - Normalizar envelopes de forma PURAMENTE estrutural
   - Preencher valores default obrigatórios
   - Garantir coerência formal mínima antes do transporte interno

   IMPORTANTE:
   - NÃO interpreta payload
   - NÃO altera significado
   - NÃO corrige erros lógicos
   - NÃO decide nada
   - NÃO depende de contexto externo

   Linguagem: JavaScript (Node.js)
========================================================================== */

const {
  PROTOCOL_VERSION,
  ENVELOPE_KIND
} = require('./schemas');

/* ===========================
   Utilitários internos
=========================== */

/**
 * Cria uma cópia rasa segura de objeto simples.
 * Evita mutação do envelope original.
 */
function cloneObject(obj) {
  return Object.assign({}, obj);
}

/**
 * Retorna timestamp atual em milissegundos.
 * Valor técnico, não semântico.
 */
function now() {
  return Date.now();
}

/* ===========================
   Normalização estrutural
=========================== */

/**
 * Normaliza a estrutura do header.
 * Preenche defaults obrigatórios se ausentes.
 */
function normalizeHeader(header = {}) {
  const normalized = cloneObject(header);

  if (typeof normalized.version !== 'number') {
    normalized.version = PROTOCOL_VERSION;
  }

  if (typeof normalized.timestamp !== 'number') {
    normalized.timestamp = now();
  }

  // source é obrigatório estruturalmente,
  // mas sua ausência será tratada pela validação, não aqui
  return normalized;
}

/**
 * Normaliza a estrutura dos identificadores.
 * NÃO gera UUIDs automaticamente.
 */
function normalizeIds(ids = {}) {
  return cloneObject(ids);
}

/**
 * Normaliza o envelope completo.
 *
 * @param {Object} envelope
 * @returns {Object} novo envelope normalizado
 *
 * OBS:
 * - Não valida (isso é papel do validator)
 * - Não altera payload
 * - Não corrige estrutura inválida
 */
function normalizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return envelope;
  }

  const normalized = cloneObject(envelope);

  normalized.header = normalizeHeader(envelope.header);
  normalized.ids = normalizeIds(envelope.ids);

  // kind é preservado se válido; validação decide
  if (typeof normalized.kind !== 'string') {
    normalized.kind = envelope.kind;
  }

  // payload é completamente opaco
  normalized.payload = envelope.payload;

  // Campos opcionais preservados sem interpretação
  if ('ack_for' in envelope) {
    normalized.ack_for = envelope.ack_for;
  }

  return normalized;
}

/* ===========================
   Interface pública do módulo
=========================== */

module.exports = Object.freeze({
  normalizeEnvelope
});
