/* ==========================================================================
   src/shared/nerv/schemas.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: Protocol (Linguagem Universal)
   Audit Level: 520 — NERV Protocol Constitutional Validation
   Status: CONSTITUTIONALLY EXECUTABLE (Singularity Edition)
   
   Responsabilidade: Impedir envelopes ontologicamente inválidos
   - Validação estrutural: protocol/identity/causality/type/payload
   - Validação ontológica: MessageType, ActionCode, ActorRole
   - Guardas de imutabilidade e consistência
========================================================================== */

const {
  PROTOCOL_VERSION,
  MessageType,
  ActionCode,
  ActorRole
} = require('./constants');

/* --------------------------------------------------------------------------
 * INTERNAL GUARDS
 * ------------------------------------------------------------------------ */

function violation(message) {
  throw new Error(`[IPC SCHEMA VIOLATION] ${message}`);
}

function isPlainObject(obj) {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    !Array.isArray(obj)
  );
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/* --------------------------------------------------------------------------
 * STRUCTURAL VALIDATION
 * ------------------------------------------------------------------------ */

function validateStructure(envelope) {
  if (!isPlainObject(envelope)) {
    violation('Envelope must be an object');
  }

  const { protocol, identity, causality, type, payload } = envelope;

  if (!isPlainObject(protocol)) {
    violation('Missing or invalid protocol block');
  }

  if (protocol.version !== PROTOCOL_VERSION) {
    violation(`Protocol version mismatch: ${protocol.version}`);
  }

  if (typeof protocol.timestamp !== 'number') {
    violation('Protocol timestamp must be a number');
  }

  if (!isPlainObject(identity)) {
    violation('Missing or invalid identity block');
  }

  if (!isPlainObject(causality)) {
    violation('Missing or invalid causality block');
  }

  if (!isPlainObject(type)) {
    violation('Missing or invalid type block');
  }

  if (!isPlainObject(payload)) {
    violation('Payload must be a plain object');
  }
}

/* --------------------------------------------------------------------------
 * ONTOLOGICAL VALIDATION
 * ------------------------------------------------------------------------ */

function validateOntology(envelope) {
  const { identity, causality, type, payload } = envelope;

  /* ---- Identity ---- */
  if (!Object.values(ActorRole).includes(identity.actor)) {
    violation(`Invalid actor role: ${identity.actor}`);
  }

  if (identity.target !== null) {
    if (!Object.values(ActorRole).includes(identity.target)) {
      violation(`Invalid target actor: ${identity.target}`);
    }
  }

  /* ---- Causality ---- */
  if (!isUUID(causality.msg_id)) {
    violation('msg_id must be a valid UUID');
  }

  if (!isUUID(causality.correlation_id)) {
    violation('correlation_id must be a valid UUID');
  }

  /* ---- Type ---- */
  if (!Object.values(MessageType).includes(type.message_type)) {
    violation(`Invalid message_type: ${type.message_type}`);
  }

  if (!Object.values(ActionCode).includes(type.action_code)) {
    violation(`Invalid action_code: ${type.action_code}`);
  }

  /* ---- ACK constraints ---- */
  if (type.message_type === MessageType.ACK) {
    if (Object.keys(payload).length !== 0) {
      violation('ACK must not carry semantic payload');
    }
  }

  /* ---- EVENT constraints ---- */
  if (type.message_type === MessageType.EVENT && identity.target !== null) {
    violation('EVENT must not be explicitly targeted');
  }
}

/* --------------------------------------------------------------------------
 * NEGATIVE VALIDATION (PROHIBITIONS)
 * ------------------------------------------------------------------------ */

const FORBIDDEN_FIELDS = [
  'status',
  'result',
  'success',
  'error',
  'response',
  'return_value',
  'exception',
  'completed'
];

function validateProhibitions(envelope) {
  const serialized = JSON.stringify(envelope);

  for (const field of FORBIDDEN_FIELDS) {
    if (serialized.includes(`"${field}"`)) {
      violation(`Forbidden semantic field detected: ${field}`);
    }
  }
}

/* --------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

function validateEnvelope(envelope) {
  validateStructure(envelope);
  validateOntology(envelope);
  validateProhibitions(envelope);
  return true;
}

module.exports = {
  validateEnvelope
};