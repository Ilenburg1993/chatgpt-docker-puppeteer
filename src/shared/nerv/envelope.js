/* ==========================================================================
   src/shared/nerv/envelope.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: Protocol (Linguagem Universal)
   Audit Level: 510 — NERV Protocol Canonical Envelope
   Status: CONSTITUTIONAL (Singularity Edition)

   Responsabilidade: Construção imutável do Envelope NERV
   - Factory createEnvelope() com validação constitucional
   - Estrutura: protocol/identity/causality/type/payload (5 blocos)
   - Imutabilidade garantida por deepFreeze
   - Zero inferência: todos os campos explícitos
========================================================================== */

const { PROTOCOL_VERSION, MessageType, ActionCode, ActorRole } = require('./constants');

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
function createEnvelope({ actor, messageType, actionCode, payload = {}, correlationId = null, target = null }) {
    /* ------------------------------------------------------------------------
     * LAYER 1 — PROTOCOL
     * ---------------------------------------------------------------------- */
    assert(PROTOCOL_VERSION, 'Protocol version must be explicit');

    /* ------------------------------------------------------------------------
     * LAYER 2 — IDENTITY
     * ---------------------------------------------------------------------- */
    assert(Object.values(ActorRole).includes(actor), `Invalid actor role: ${actor}`);

    if (target !== null) {
        assert(Object.values(ActorRole).includes(target), `Invalid target actor: ${target}`);
    }

    /* ------------------------------------------------------------------------
     * LAYER 3 — CAUSALITY
     * ---------------------------------------------------------------------- */
    const msgId = uuidv4();
    // Sanity-check do msgId gerado para manter invariantes do protocolo
    assertUUID(msgId, 'msg_id');

    if (correlationId !== null) {
        assert(typeof correlationId === 'string', 'correlationId must be a string');
        assert(correlationId.length > 0, 'correlationId cannot be empty');
    }

    const effectiveCorrelationId = correlationId || msgId;

    /* ------------------------------------------------------------------------
     * LAYER 4 — ONTOLOGICAL TYPE
     * ---------------------------------------------------------------------- */
    assert(Object.values(MessageType).includes(messageType), `Invalid message type: ${messageType}`);

    assert(Object.values(ActionCode).includes(actionCode), `Invalid action code: ${actionCode}`);

    if (messageType === MessageType.ACK) {
        assert(Object.keys(payload).length === 0, 'ACK must not carry semantic payload');
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
        if (typeof obj[key] === 'object' && obj[key] !== null && !Object.isFrozen(obj[key])) {
            deepFreeze(obj[key]);
        }
    }
    return obj;
}

module.exports = {
    createEnvelope
};

// Normalization helper: accepts either a canonical envelope or a flattened
// envelope ({ actor, messageType, actionCode, payload, correlationId, target })
// and returns a canonical, validated envelope.
function normalize(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        throw new Error('Envelope must be an object');
    }
    // If already canonical (has protocol/identity/type/causality), return as-is
    if (envelope.protocol && envelope.identity && envelope.type && envelope.causality) {
        return envelope;
    }

    // Legacy shape support: header/ids/kind/payload
    // Example legacy fields: envelope.header.source, envelope.ids.correlation_id, envelope.kind, envelope.payload
    if (envelope.header && envelope.ids && (envelope.kind || envelope.type)) {
        const headerSource = envelope.header.source || envelope.header?.source;
        const actorKey = headerSource ? String(headerSource).toUpperCase() : null;
        const actor = actorKey && ActorRole[actorKey] ? ActorRole[actorKey] : null;

        const headerTarget = envelope.header.target || null;
        const targetKey = headerTarget ? String(headerTarget).toUpperCase() : null;
        const target = targetKey && ActorRole[targetKey] ? ActorRole[targetKey] : null;

        const messageType = envelope.kind || (envelope.type && envelope.type.message_type);
        const actionCode = (envelope.payload && envelope.payload.actionCode) || envelope.actionCode || (envelope.type && envelope.type.action_code) || null;
        const payload = envelope.payload || envelope.data || {};
        const correlationId = envelope.ids && (envelope.ids.correlation_id || envelope.ids.correlationId) ? (envelope.ids.correlation_id || envelope.ids.correlationId) : null;

        return createEnvelope({ actor, messageType, actionCode, payload, correlationId, target });
    }

    // Otherwise attempt to construct via createEnvelope (will validate)
    const actor = envelope.actor || (envelope.identity && envelope.identity.actor);
    const messageType = envelope.messageType || (envelope.type && envelope.type.message_type);
    const actionCode = envelope.actionCode || (envelope.type && envelope.type.action_code);
    const payload = envelope.payload || envelope.data || {};
    const correlationId = envelope.correlationId || (envelope.causality && envelope.causality.correlation_id) || null;
    const target = envelope.target || (envelope.identity && envelope.identity.target) || null;

    return createEnvelope({ actor, messageType, actionCode, payload, correlationId, target });
}

function assertValid(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        throw new Error('Envelope must be an object');
    }

    // If canonical shape, perform lightweight checks
    if (envelope.protocol && envelope.identity && envelope.type && envelope.causality) {
        if (!envelope.protocol.version) throw new Error('protocol.version missing');
        if (!envelope.identity.actor) throw new Error('identity.actor missing');
        if (!envelope.type.message_type || !envelope.type.action_code) throw new Error('type fields missing');
        return true;
    }

    // Fallback: try to create envelope (will throw on invalid)
    createEnvelope({
        actor: envelope.actor,
        messageType: envelope.messageType,
        actionCode: envelope.actionCode,
        payload: envelope.payload || envelope.data || {},
        correlationId: envelope.correlationId || null,
        target: envelope.target || null
    });

    return true;
}

// Augment exports
module.exports = {
    createEnvelope,
    normalize,
    assertValid
};
