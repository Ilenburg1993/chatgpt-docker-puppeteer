// @ts-check - Type checking rigoroso habilitado (arquivo core)

function getMessageType(envelope) {
    return (
        envelope?.kind ||
        envelope?.messageType ||
        envelope?.type?.message_type ||
        envelope?.type?.messageType ||
        null
    );
}

function getActionCode(envelope) {
    return (
        envelope?.actionCode ||
        envelope?.type?.action_code ||
        envelope?.type?.actionCode ||
        envelope?.payload?.actionCode ||
        null
    );
}

function getCorrelationId(envelope) {
    return (
        envelope?.correlationId ||
        envelope?.ids?.correlation_id ||
        envelope?.ids?.correlationId ||
        envelope?.causality?.correlation_id ||
        null
    );
}

function getPayload(envelope) {
    return envelope?.payload || {};
}

function getTaskIdFromPayload(payload) {
    return payload?.taskId || payload?.task_id || payload?.task?.meta?.id || payload?.task?.id || null;
}

export { getMessageType, getActionCode, getCorrelationId, getPayload, getTaskIdFromPayload };
