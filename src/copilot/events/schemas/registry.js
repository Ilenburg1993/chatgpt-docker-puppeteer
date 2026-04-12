// @ts-check
/**
 * src/copilot/events/schemas/registry.js — FAIXA-L18
 *
 * Schema Registry para tipos de evento do EventBus. Permite registrar schemas por tipo de evento e validar payloads.
 *
 * Em modo dev: strict validation (logs + pode bloquear). Em modo prod: log warning, nao bloqueia.
 *
 * @module copilot/events/schemas/registry
 */

/**
 * @typedef {object} EventSchema
 * @property {string} type - Tipo de evento (ex: 'agent:dialog:turn_end')
 * @property {string[]} required - Campos obrigatórios no evento
 * @property {Record<string, string>} [fields] - Mapa campo -> tipo esperado ('string', 'number', 'boolean', 'object')
 * @property {string} [description] - Descrição do evento
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 */

/** @type {Map<string, EventSchema>} */
const _schemas = new Map();

/**
 * Registra um schema para um tipo de evento.
 *
 * @param {EventSchema} schema
 * @returns {void}
 */
export function registerEventSchema(schema) {
    _schemas.set(schema.type, schema);
}

/**
 * Registra múltiplos schemas de uma vez.
 *
 * @param {EventSchema[]} schemas
 * @returns {void}
 */
export function registerEventSchemas(schemas) {
    for (const s of schemas) {
        _schemas.set(s.type, s);
    }
}

/**
 * Valida um evento contra o schema registrado.
 *
 * @param {Record<string, unknown>} event
 * @returns {ValidationResult}
 */
export function validateEvent(event) {
    const type = /** @type {string} */ (event.type);
    const schema = _schemas.get(type);

    if (!schema) {
        return { valid: true, errors: [] }; // No schema = no validation
    }

    /** @type {string[]} */
    const errors = [];

    // Check required fields
    for (const field of schema.required) {
        if (!(field in event) || event[field] === undefined) {
            errors.push(`missing required field '${field}'`);
        }
    }

    // Check field types
    if (schema.fields) {
        for (const [field, expectedType] of Object.entries(schema.fields)) {
            if (field in event && event[field] !== undefined) {
                const actual = typeof event[field];
                if (actual !== expectedType) {
                    errors.push(`field '${field}' expected ${expectedType}, got ${actual}`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Retorna o schema registrado para um tipo, ou undefined.
 *
 * @param {string} type
 * @returns {EventSchema | undefined}
 */
export function getEventSchema(type) {
    return _schemas.get(type);
}

/**
 * Retorna todos os schemas registrados.
 *
 * @returns {Map<string, EventSchema>}
 */
export function getAllSchemas() {
    return new Map(_schemas);
}

/**
 * Limpa todos os schemas (para testes).
 *
 * @returns {void}
 */
export function clearSchemas() {
    _schemas.clear();
}

/**
 * Retorna o numero de schemas registrados.
 *
 * @returns {number}
 */
export function schemaCount() {
    return _schemas.size;
}
