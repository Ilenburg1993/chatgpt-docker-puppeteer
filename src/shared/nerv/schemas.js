// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActionCode, ActorRole, MessageType, PROTOCOL_VERSION } from './constants.js';

/* --------------------------------------------------------------------------
 * INTERNAL GUARDS
 * ------------------------------------------------------------------------ */

/**
 * Lança erro de violação de esquema IPC
 * @param {string} message - Mensagem de erro descritiva
 * @throws {Error} Sempre lança erro com prefixo [IPC SCHEMA VIOLATION]
 * @sideEffects Lança erro - função de validação
 */
function violation(message) {
    throw new Error(`[IPC SCHEMA VIOLATION] ${message}`);
}

/**
 * Verifica se valor é um objeto plano (não array, não null)
 * @param {*} obj - Valor a ser verificado
 * @returns {boolean} true se for objeto plano
 * @sideEffects Nenhum - função pura
 */
function isPlainObject(obj) {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Valida se string é um UUID válido (formato RFC 4122)
 * @param {string} value - String a ser validada
 * @returns {boolean} true se for UUID válido
 * @sideEffects Nenhum - função pura
 */
function isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/* --------------------------------------------------------------------------
 * STRUCTURAL VALIDATION
 * ------------------------------------------------------------------------ */

/**
 * Valida a estrutura básica de um envelope NERV canônico
 * @param {object} envelope - Envelope a ser validado
 * @param {object} envelope.protocol - Bloco de protocolo
 * @param {string} envelope.protocol.version - Versão do protocolo
 * @param {number} envelope.protocol.timestamp - Timestamp numérico
 * @param {object} envelope.identity - Bloco de identidade
 * @param {object} envelope.causality - Bloco de causalidade
 * @param {object} envelope.type - Bloco de tipo
 * @param {object} envelope.payload - Payload da mensagem
 * @throws {Error} Se a estrutura violar o esquema
 * @sideEffects Pode lançar erro - função de validação
 */
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

/**
 * Valida a ontologia e semântica de um envelope NERV
 * @param {object} envelope - Envelope a ser validado
 * @param {object} envelope.identity - Bloco de identidade com actor e target
 * @param {object} envelope.causality - Bloco de causalidade com IDs UUID
 * @param {object} envelope.type - Bloco de tipo com message_type e action_code
 * @param {object} envelope.payload - Payload da mensagem
 * @throws {Error} Se a ontologia violar as regras do protocolo
 * @sideEffects Pode lançar erro - função de validação
 */
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

/* --------------------------------------------------------------------------
 * NEGATIVE VALIDATION (PROHIBITIONS)
 * ------------------------------------------------------------------------ */

const FORBIDDEN_FIELDS = ['status', 'result', 'success', 'error', 'response', 'return_value', 'exception', 'completed'];

/**
 * Valida proibições semânticas em envelope NERV (campos proibidos)
 * @param {object} envelope - Envelope a ser verificado
 * @throws {Error} Se encontrar campos semânticos proibidos
 * @sideEffects Pode lançar erro - função de validação negativa
 */
function validateProhibitions(envelope) {
    // Recursive walk para detectar campos proibidos (mais eficiente que JSON.stringify)
    function walk(obj, path = 'envelope') {
        if (typeof obj !== 'object' || obj === null) return;

        for (const key of Object.keys(obj)) {
            if (FORBIDDEN_FIELDS.includes(key)) {
                violation(`Forbidden semantic field detected: ${path}.${key}`);
            }
            walk(obj[key], `${path}.${key}`);
        }
    }

    walk(envelope);
}

/* --------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

/**
 * Valida completamente um envelope NERV (estrutura + ontologia + proibições)
 * @param {object} envelope - Envelope NERV canônico a ser validado
 * @returns {boolean} true se válido
 * @throws {Error} Se qualquer aspecto do envelope violar o esquema
 * @sideEffects Pode lançar erro - função de validação completa
 */
function validateEnvelope(envelope) {
    validateStructure(envelope);
    validateOntology(envelope);
    validateProhibitions(envelope);
    return true;
}

/**
 * Valida a identidade de um robô/agente no sistema NERV
 * @param {object} identity - Objeto de identidade a ser validado
 * @param {string} identity.robot_id - ID único do robô
 * @param {string} identity.instance_id - ID da instância específica
 * @param {import('./constants.js').ActorRole} identity.role - Papel do ator no sistema
 * @param {string} identity.version - Versão do software do robô
 * @param {string[]} identity.capabilities - Array de capacidades do robô
 * @returns {object} A identidade validada (retornada para chaining)
 * @throws {Error} Se a identidade não atender aos requisitos
 * @sideEffects Pode lançar erro - função de validação
 */
function validateRobotIdentity(identity) {
    if (!identity || typeof identity !== 'object') {
        violation('Identity must be a plain object');
    }

    if (!identity.robot_id || typeof identity.robot_id !== 'string') {
        violation('robot_id is required and must be a string');
    }

    if (!identity.instance_id || typeof identity.instance_id !== 'string') {
        violation('instance_id is required and must be a string');
    }

    if (!identity.role || !Object.values(ActorRole).includes(identity.role)) {
        violation(`role must be one of: ${Object.values(ActorRole).join(', ')}`);
    }

    if (!identity.version || typeof identity.version !== 'string') {
        violation('version is required and must be a string');
    }

    if (!Array.isArray(identity.capabilities)) {
        violation('capabilities must be an array');
    }

    return identity;
}

/**
 * Valida um envelope de IPC (InterProcess Communication) - wrapper legado
 * @param {object} envelope - Envelope IPC a ser validado
 * @returns {boolean} true se válido
 * @throws {Error} Se o envelope violar o esquema
 * @sideEffects Pode lançar erro - função de validação
 * @deprecated Use validateEnvelope diretamente para novos códigos
 */
function validateIPCEnvelope(envelope) {
    return validateEnvelope(envelope);
}

export { validateEnvelope, validateIPCEnvelope, validateRobotIdentity };
