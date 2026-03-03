// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { createEnvelope } from '#shared/nerv/envelope';
import { MessageType } from '#shared/nerv/constants';

/**
 * Função exportada: makeEnvelope.
 * @returns {any}
 */
function makeEnvelope({ actor, target = null, messageType, actionCode, payload = {}, correlationId = null }) {
    return createEnvelope({ actor, target, messageType, actionCode, payload, correlationId });
}

/**
 * Send NERV event (async).
 * ✅ P1-4: Now properly awaits emission and propagates errors.
 * @param {object} nerv - NERV instance
 * @param {string} actor - Actor role
 * @param {string} actionCode - Action code
 * @param {object} [payload={}] - Event payload
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
 * Send NERV command (async).
 * ✅ P1-4: Now properly awaits emission and propagates errors.
 * @param {object} nerv - NERV instance
 * @param {string} actor - Actor role
 * @param {string} actionCode - Action code
 * @param {object} [payload={}] - Command payload
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
 * Send NERV acknowledgment (async).
 * ✅ P1-4: Now properly awaits emission and propagates errors.
 * @param {object} nerv - NERV instance
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
