// @ts-check
import { createEnvelope } from '#shared/nerv/envelope';
import { MessageType } from '#shared/nerv/constants';

/**
 * @typedef {object} MakeEnvelopeOptions
 * @property {*} [actor]
 * @property {*} [target]
 * @property {*} [messageType]
 * @property {*} [actionCode]
 * @property {*} [payload]
 */
/**
 * Função exportada: makeEnvelope.
 * @param {MakeEnvelopeOptions} [options]
 * @returns {object}
 */
function makeEnvelope({ actor, target = null, messageType, actionCode, payload = {}, correlationId = null }) {
    return createEnvelope({ actor, target, messageType, actionCode, payload, correlationId });
}

/**
 * @typedef {object} SendEventNerv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * @typedef {object} SendEventInput
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Send NERV event (async).
 * ✅ P1-4: Now properly awaits emission and propagates errors.
 * @param {SendEventNerv} nerv - NERV instance
 * @param {string} actor - Actor role
 * @param {string} actionCode - Action code
 * @param {SendEventInput} [payload={}] - Event payload
 * @param {string|null} [correlationId=null] - Correlation ID
 * @param {string|null} [target=null] - Target actor
 * @returns {Promise<object>} Resolved envelope
 * @throws {Error} If emission fails
 */
async function sendEvent(nerv, actor, actionCode, payload = {}, correlationId = null, target = null) {
    const envelope = makeEnvelope({
        actor,
        target,
        messageType: MessageType.EVENT,
        actionCode,
        payload,
        correlationId,
    });
    if (!nerv || typeof nerv.emitEvent !== 'function') {
        throw new Error('NERV instance with emitEvent required');
    }
    await nerv.emitEvent(envelope); // ✅ P1-4: Added await
    return envelope;
}

/**
 * @typedef {object} SendCommandNerv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * @typedef {object} SendCommandInput
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Send NERV command (async).
 * ✅ P1-4: Now properly awaits emission and propagates errors.
 * @param {SendCommandNerv} nerv - NERV instance
 * @param {string} actor - Actor role
 * @param {string} actionCode - Action code
 * @param {SendCommandInput} [payload={}] - Command payload
 * @param {string|null} [correlationId=null] - Correlation ID
 * @param {string|null} [target=null] - Target actor
 * @returns {Promise<object>} Resolved envelope
 * @throws {Error} If emission fails
 */
async function sendCommand(nerv, actor, actionCode, payload = {}, correlationId = null, target = null) {
    const envelope = makeEnvelope({
        actor,
        target,
        messageType: MessageType.COMMAND,
        actionCode,
        payload,
        correlationId,
    });
    if (!nerv || typeof nerv.emitCommand !== 'function') {
        throw new Error('NERV instance with emitCommand required');
    }
    await nerv.emitCommand(envelope); // ✅ P1-4: Added await
    return envelope;
}

/**
 * @typedef {object} SendAckNerv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Send NERV acknowledgment (async).
 * ✅ P1-4: Now properly awaits emission and propagates errors.
 * @param {SendAckNerv} nerv - NERV instance
 * @param {string} actor - Actor role
 * @param {string} actionCode - Action code
 * @param {string|null} [correlationId=null] - Correlation ID
 * @param {string|null} [target=null] - Target actor
 * @returns {Promise<object>} Resolved envelope
 * @throws {Error} If emission fails
 */
async function sendAck(nerv, actor, actionCode, correlationId = null, target = null) {
    const envelope = makeEnvelope({
        actor,
        target,
        messageType: MessageType.ACK,
        actionCode,
        payload: {},
        correlationId,
    });
    if (!nerv || typeof nerv.emitAck !== 'function') {
        throw new Error('NERV instance with emitAck required');
    }
    await nerv.emitAck(envelope); // ✅ P1-4: Added await
    return envelope;
}

export { makeEnvelope, sendEvent, sendCommand, sendAck };
