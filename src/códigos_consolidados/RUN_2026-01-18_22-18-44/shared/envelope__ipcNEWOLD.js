FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\shared\ipcNEWOLD\envelope.js
PASTA_BASE: shared
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/shared/ipc/envelope.js
   Audit Level: 510 — IPC 2.0 Canonical Envelope
   Status: CONSTITUTIONAL
   Responsabilidade: Construção imutável do Envelope IPC
========================================================================== */

const {
  PROTOCOL_VERSION,
  MessageType,
  ActionCode,
  ActorRole
} = require('./constants');

const { v4: uuidv4 } = require('uuid');

/**
 * --------------------------------------------------------------------------
 * INTERNAL GUARDS
 * --------------------------------------------------------------------------
 */

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[IPC ENVELOPE VIOLATION] ${message}`);
  }
}

function assertUUID(value, field) {
  assert(typeof value === 'string', `${field} must be a string`);
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    `${field} must be a valid UUID`
  );
}

/**
 * --------------------------------------------------------------------------
 * ENVELOPE FACTORY (CANONICAL)
 * --------------------------------------------------------------------------
 * Creates an immutable IPC envelope.
 * No defaults hide intent. No field is inferred.
 */
function createEnvelope({
  actor,
  messageType,
  actionCode,
  payload = {},
  correlationId = null,
  target = null
}) {
  /* ------------------------------------------------------------------------
   * LAYER 1 — PROTOCOL
   * ---------------------------------------------------------------------- */
  assert(PROTOCOL_VERSION, 'Protocol version must be explicit');

  /* ------------------------------------------------------------------------
   * LAYER 2 — IDENTITY
   * ---------------------------------------------------------------------- */
  assert(
    Object.values(ActorRole).includes(actor),
    `Invalid actor role: ${actor}`
  );

  if (target !== null) {
    assert(
      Object.values(ActorRole).includes(target),
      `Invalid target actor: ${target}`
    );
  }

  /* ------------------------------------------------------------------------
   * LAYER 3 — CAUSALITY
   * ---------------------------------------------------------------------- */
  const msgId = uuidv4();

  if (correlationId !== null) {
    assertUUID(correlationId, 'correlationId');
  }

  const effectiveCorrelationId = correlationId || msgId;

  /* ------------------------------------------------------------------------
   * LAYER 4 — ONTOLOGICAL TYPE
   * ---------------------------------------------------------------------- */
  assert(
    Object.values(MessageType).includes(messageType),
    `Invalid message type: ${messageType}`
  );

  assert(
    Object.values(ActionCode).includes(actionCode),
    `Invalid action code: ${actionCode}`
  );

  if (messageType === MessageType.ACK) {
    assert(
      Object.keys(payload).length === 0,
      'ACK must not carry semantic payload'
    );
  }

  /* ------------------------------------------------------------------------
   * LAYER 5 — PAYLOAD
   * ---------------------------------------------------------------------- */
  assert(
    typeof payload === 'object' && payload !== null && !Array.isArray(payload),
    'Payload must be a plain object'
  );

  /* ------------------------------------------------------------------------
   * ENVELOPE CONSTRUCTION
   * ---------------------------------------------------------------------- */
  const envelope = {
    protocol: {
      version: PROTOCOL_VERSION,
      timestamp: Date.now()
    },

    identity: {
      actor,
      target
    },

    causality: {
      msg_id: msgId,
      correlation_id: effectiveCorrelationId
    },

    type: {
      message_type: messageType,
      action_code: actionCode
    },

    payload
  };

  /* ------------------------------------------------------------------------
   * IMMUTABILITY GUARANTEE
   * ---------------------------------------------------------------------- */
  return deepFreeze(envelope);
}

/**
 * --------------------------------------------------------------------------
 * DEEP FREEZE
 * --------------------------------------------------------------------------
 * Ensures total immutability of the envelope.
 */
function deepFreeze(obj) {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    if (
      typeof obj[key] === 'object' &&
      obj[key] !== null &&
      !Object.isFrozen(obj[key])
    ) {
      deepFreeze(obj[key]);
    }
  }
  return obj;
}

module.exports = {
  createEnvelope
};