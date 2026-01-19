FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\envelopes\schemas.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/nerv/envelopes/schemas.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: envelopes/
   Arquivo: schemas.js

   Papel:
   - Definir a estrutura canônica do envelope IPC
   - Centralizar constantes estruturais
   - Fornecer validadores puramente formais (sem semântica)

   IMPORTANTE:
   - Este módulo NÃO interpreta payload
   - Este módulo NÃO decide nada
   - Este módulo NÃO conhece Kernel, Driver ou Server
   - Este módulo valida APENAS forma estrutural

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Constantes canônicas
=========================== */

/**
 * Versão atual do protocolo IPC/NERV.
 * Deve ser incrementada apenas por decisão arquitetural.
 */
const PROTOCOL_VERSION = 1;

/**
 * Tipos estruturais permitidos.
 * Tipagem NOMINAL, não semântica.
 */
const ENVELOPE_KIND = Object.freeze({
  COMMAND: 'COMMAND',
  EVENT: 'EVENT',
  ACK: 'ACK'
});

/**
 * Campos obrigatórios por seção.
 * Usado apenas para verificação estrutural.
 */
const REQUIRED_FIELDS = Object.freeze({
  header: ['version', 'timestamp', 'source'],
  ids: ['msg_id', 'correlation_id'],
  envelope: ['header', 'ids', 'kind', 'payload']
});

/* ===========================
   Utilitários estruturais
=========================== */

/**
 * Verifica se um valor é um objeto simples.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Verifica se um valor é um UUID válido (forma).
 * Nenhuma semântica associada.
 */
function isUUID(value) {
  if (typeof value !== 'string') return false;

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidRegex.test(value);
}

/**
 * Verifica se o tipo do envelope é permitido.
 */
function isValidKind(kind) {
  return Object.values(ENVELOPE_KIND).includes(kind);
}

/* ===========================
   Validação estrutural
=========================== */

/**
 * Valida a estrutura mínima do header.
 * NÃO interpreta valores.
 */
function validateHeader(header) {
  if (!isObject(header)) {
    return 'header deve ser um objeto';
  }

  for (const field of REQUIRED_FIELDS.header) {
    if (!(field in header)) {
      return `header.${field} é obrigatório`;
    }
  }

  if (typeof header.version !== 'number') {
    return 'header.version deve ser numérico';
  }

  if (typeof header.timestamp !== 'number') {
    return 'header.timestamp deve ser numérico';
  }

  if (typeof header.source !== 'string') {
    return 'header.source deve ser string';
  }

  // target é opcional e opaco
  if ('target' in header && typeof header.target !== 'string') {
    return 'header.target deve ser string se presente';
  }

  return null;
}

/**
 * Valida a estrutura dos identificadores.
 */
function validateIds(ids) {
  if (!isObject(ids)) {
    return 'ids deve ser um objeto';
  }

  for (const field of REQUIRED_FIELDS.ids) {
    if (!(field in ids)) {
      return `ids.${field} é obrigatório`;
    }
  }

  if (!isUUID(ids.msg_id)) {
    return 'ids.msg_id deve ser UUID válido';
  }

  if (!isUUID(ids.correlation_id)) {
    return 'ids.correlation_id deve ser UUID válido';
  }

  return null;
}

/**
 * Valida a estrutura completa do envelope.
 * Retorna null se válido, ou string descrevendo o erro estrutural.
 */
function validateEnvelopeStructure(envelope) {
  if (!isObject(envelope)) {
    return 'envelope deve ser um objeto';
  }

  for (const field of REQUIRED_FIELDS.envelope) {
    if (!(field in envelope)) {
      return `campo obrigatório ausente: ${field}`;
    }
  }

  const headerError = validateHeader(envelope.header);
  if (headerError) return headerError;

  const idsError = validateIds(envelope.ids);
  if (idsError) return idsError;

  if (!isValidKind(envelope.kind)) {
    return `kind inválido: ${envelope.kind}`;
  }

  // Payload é propositalmente opaco
  if (!isObject(envelope.payload)) {
    return 'payload deve ser um objeto';
  }

  return null;
}

/* ===========================
   API estrutural do módulo
=========================== */

/**
 * Verifica se o envelope é estruturalmente válido.
 * Retorna booleano.
 */
function isValidEnvelope(envelope) {
  return validateEnvelopeStructure(envelope) === null;
}

/**
 * Asserção estrutural.
 * Lança erro técnico se inválido.
 */
function assertValidEnvelope(envelope) {
  const error = validateEnvelopeStructure(envelope);
  if (error) {
    throw new Error(`Envelope inválido (estrutura): ${error}`);
  }
}

/* ===========================
   Exportação canônica
=========================== */

module.exports = Object.freeze({
  PROTOCOL_VERSION,
  ENVELOPE_KIND,
  isValidEnvelope,
  assertValidEnvelope
});
