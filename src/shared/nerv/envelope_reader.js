// @ts-check - Type checking rigoroso habilitado (arquivo core)

/**
 * @typedef {object} GetMessageTypeEnvelope
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Extrai o tipo de mensagem de envelope NERV (suporta formatos canônico e legado)
 * @param {GetMessageTypeEnvelope} envelope - Envelope NERV a ser analisado
 * @returns {import('./constants.js').MessageType|null} Tipo da mensagem ou null se não encontrado
 * @sideEffects Nenhum - função pura
 */
function getMessageType(envelope) {
    return (
        envelope?.kind || envelope?.messageType || envelope?.type?.message_type || envelope?.type?.messageType || null
    );
}

/**
 * @typedef {object} GetActionCodeEnvelope
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Extrai o código de ação de envelope NERV (suporta formatos canônico e legado)
 * @param {GetActionCodeEnvelope} envelope - Envelope NERV a ser analisado
 * @returns {string|null} Código da ação ou null se não encontrado
 * @sideEffects Nenhum - função pura
 */
function getActionCode(envelope) {
    return (
        envelope?.actionCode ||
        envelope?.type?.action_code ||
        envelope?.type?.actionCode ||
        envelope?.payload?.actionCode ||
        null
    );
}

/**
 * @typedef {object} GetCorrelationIdEnvelope
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Extrai o ID de correlação de envelope NERV (suporta formatos canônico e legado)
 * @param {GetCorrelationIdEnvelope} envelope - Envelope NERV a ser analisado
 * @returns {string|null} ID de correlação ou null se não encontrado
 * @sideEffects Nenhum - função pura
 */
function getCorrelationId(envelope) {
    return (
        envelope?.correlationId ||
        envelope?.ids?.correlation_id ||
        envelope?.ids?.correlationId ||
        envelope?.causality?.correlation_id ||
        null
    );
}

/**
 * @typedef {object} GetMsgIdEnvelope
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Extrai o ID da mensagem de envelope NERV (suporta formatos canônico e legado)
 * @param {GetMsgIdEnvelope} envelope - Envelope NERV a ser analisado
 * @returns {string|null} ID da mensagem ou null se não encontrado
 * @sideEffects Nenhum - função pura
 */
function getMsgId(envelope) {
    return envelope?.msgId || envelope?.ids?.msg_id || envelope?.ids?.msgId || envelope?.causality?.msg_id || null;
}

/**
 * @typedef {object} GetPayloadEnvelope
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Extrai o payload de envelope NERV
 * @param {GetPayloadEnvelope} envelope - Envelope NERV a ser analisado
 * @returns {object} Payload da mensagem (objeto vazio se não encontrado)
 * @sideEffects Nenhum - função pura
 */
function getPayload(envelope) {
    return envelope?.payload || {};
}

/**
 * @typedef {object} GetTaskIdFromPayloadPayload
 * @property {*} _ Propriedades definidas via runtime.
 */
/**
 * Extrai o ID da tarefa do payload de envelope NERV
 * @param {GetTaskIdFromPayloadPayload} payload - Payload da mensagem a ser analisado
 * @returns {string|null} ID da tarefa ou null se não encontrado
 * @sideEffects Nenhum - função pura
 */
function getTaskIdFromPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload.taskId || payload.task_id || payload.task?.meta?.id || payload.task?.id || null;
}

export { getActionCode, getCorrelationId, getMessageType, getMsgId, getPayload, getTaskIdFromPayload };
