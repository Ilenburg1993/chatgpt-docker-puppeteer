import { createEnvelope } from '#shared/nerv/envelope';
import { MessageType } from '#shared/nerv/constants';

function makeEnvelope({ actor, target = null, messageType, actionCode, payload = {}, correlationId = null }) {
    return createEnvelope({ actor, target, messageType, actionCode, payload, correlationId });
}

function sendEvent(nerv, actor, actionCode, payload = {}, correlationId = null, target = null) {
    const envelope = makeEnvelope({
        actor,
        target,
        messageType: MessageType.EVENT,
        actionCode,
        payload,
        correlationId
    });
    if (!nerv || typeof nerv.emitEvent !== 'function') {
        throw new Error('NERV instance with emitEvent required');
    }
    nerv.emitEvent(envelope);
    return envelope;
}

function sendCommand(nerv, actor, actionCode, payload = {}, correlationId = null, target = null) {
    const envelope = makeEnvelope({
        actor,
        target,
        messageType: MessageType.COMMAND,
        actionCode,
        payload,
        correlationId
    });
    if (!nerv || typeof nerv.emitCommand !== 'function') {
        throw new Error('NERV instance with emitCommand required');
    }
    nerv.emitCommand(envelope);
    return envelope;
}

function sendAck(nerv, actor, actionCode, correlationId = null, target = null) {
    const envelope = makeEnvelope({
        actor,
        target,
        messageType: MessageType.ACK,
        actionCode,
        payload: {},
        correlationId
    });
    if (!nerv || typeof nerv.emitAck !== 'function') {
        throw new Error('NERV instance with emitAck required');
    }
    nerv.emitAck(envelope);
    return envelope;
}

export { makeEnvelope, sendEvent, sendCommand, sendAck };
