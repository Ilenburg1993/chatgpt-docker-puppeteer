// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActionCode, ActorRole, MessageType, PROTOCOL_VERSION } from './constants.js';

/**
 * @typedef {object} NERVRobotIdentity
 * @property {string} robot_id
 * @property {string} instance_id
 * @property {import('./constants.js').ActorRole} role
 * @property {string} version
 * @property {string[]} capabilities
 * @property {{ platform: string; node_version: string; started_at: string }} metadata
 */

/* --------------------------------------------------------------------------
 * INTERNAL GUARDS
 * ------------------------------------------------------------------------ */

/**
 * Lança erro de violação de esquema IPC
 *
 * @param {string} message - Mensagem de erro descritiva
 * @throws {Error} Sempre lança erro com prefixo [IPC SCHEMA VIOLATION]
 * @sideEffects Lança erro - função de validação
 */
function violation(/** @type {any} */ message) {
    throw new Error(`[IPC SCHEMA VIOLATION] ${message}`);
}

/**
 * @typedef {object} IsPlainObjectObj
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Verifica se valor é um objeto plano (não array, não null)
 *
 * @param {IsPlainObjectObj} obj - Valor a ser verificado
 * @returns {boolean} true se for objeto plano
 * @sideEffects Nenhum - função pura
 */
function isPlainObject(/** @type {any} */ obj) {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Valida se string é um UUID válido (formato RFC 4122)
 *
 * @param {string} value - String a ser validada
 * @returns {boolean} true se for UUID válido
 * @sideEffects Nenhum - função pura
 */
function isUUID(/** @type {any} */ value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/* --------------------------------------------------------------------------
 * STRUCTURAL VALIDATION
 * ------------------------------------------------------------------------ */

/**
 * @typedef {object} ValidateStructureEnvelope
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Valida a estrutura básica de um envelope NERV canônico
 *
 * @param {ValidateStructureEnvelope} envelope - Envelope a ser validado
 * @throws {Error} Se a estrutura violar o esquema
 * @sideEffects Pode lançar erro - função de validação
 */
function validateStructure(/** @type {any} */ envelope) {
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
 * @typedef {object} ValidateOntologyEnvelope
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Valida a ontologia e semântica de um envelope NERV
 *
 * @param {ValidateOntologyEnvelope} envelope - Envelope a ser validado
 * @throws {Error} Se a ontologia violar as regras do protocolo
 * @sideEffects Pode lançar erro - função de validação
 */
function validateOntology(/** @type {any} */ envelope) {
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
 * @typedef {object} ValidateProhibitionsEnvelope
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Valida proibições semânticas em envelope NERV (campos proibidos)
 *
 * @param {ValidateProhibitionsEnvelope} envelope - Envelope a ser verificado
 * @throws {Error} Se encontrar campos semânticos proibidos
 * @sideEffects Pode lançar erro - função de validação negativa
 */
function validateProhibitions(/** @type {any} */ envelope) {
    // Recursive walk para detectar campos proibidos (mais eficiente que JSON.stringify)
    function walk(/** @type {any} */ obj, /** @type {any} */ path = 'envelope') {
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
 * @typedef {object} ValidateEnvelopeEnvelope
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Valida completamente um envelope NERV (estrutura + ontologia + proibições)
 *
 * @param {ValidateEnvelopeEnvelope} envelope - Envelope NERV canônico a ser validado
 * @returns {boolean} true se válido
 * @throws {Error} Se qualquer aspecto do envelope violar o esquema
 * @sideEffects Pode lançar erro - função de validação completa
 */
function validateEnvelope(/** @type {any} */ envelope) {
    validateStructure(envelope);
    validateOntology(envelope);
    validateProhibitions(envelope);
    return true;
}

/**
 * Valida a identidade de um robô/agente no sistema NERV
 *
 * @param {NERVRobotIdentity} identity - Objeto de identidade a ser validado
 * @returns {NERVRobotIdentity} A identidade validada (retornada para chaining)
 * @throws {Error} Se a identidade não atender aos requisitos
 * @sideEffects Pode lançar erro - função de validação
 */
function validateRobotIdentity(/** @type {any} */ identity) {
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
 * @typedef {object} ValidateIPCEnvelopeEnvelope
 * @property {any} _ Propriedades definidas em runtime.
 */
/**
 * Valida um envelope de IPC (InterProcess Communication) - wrapper legado
 *
 * @deprecated Use validateEnvelope diretamente para novos códigos
 * @param {ValidateIPCEnvelopeEnvelope} envelope - Envelope IPC a ser validado
 * @returns {boolean} true se válido
 * @throws {Error} Se o envelope violar o esquema
 * @sideEffects Pode lançar erro - função de validação
 */
function validateIPCEnvelope(/** @type {any} */ envelope) {
    return validateEnvelope(envelope);
}

export { validateEnvelope, validateIPCEnvelope, validateRobotIdentity };
