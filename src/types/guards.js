// @ts-check - Type checking rigoroso habilitado

/**
 * @fileoverview Type Guards
 * Funções de validação de tipo em runtime para uso em todo o sistema
 */

/**
 * Verifica se valor é um objeto não-nulo
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Verifica se valor é uma string não-vazia
 * @param {unknown} value
 * @returns {value is string}
 */
export function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Verifica se valor é um número finito
 * @param {unknown} value
 * @returns {value is number}
 */
export function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Verifica se valor é um timestamp válido
 * @param {unknown} value
 * @returns {value is number}
 */
export function isValidTimestamp(value) {
    return isFiniteNumber(value) && value > 0 && value < 4102444800000; // < year 2100
}

/**
 * Verifica se valor é um UUID válido
 * @param {unknown} value
 * @returns {value is string}
 */
export function isUUID(value) {
    if (typeof value !== 'string') return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
}

/**
 * Verifica se valor é um email válido
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidEmail(value) {
    if (typeof value !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
}

/**
 * Verifica se valor é um URL válido
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidUrl(value) {
    if (typeof value !== 'string') return false;
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Verifica se valor é um enum válido
 * @param {unknown} value
 * @param {readonly string[]} enumValues
 * @returns {boolean}
 */
export function isValidEnum(value, enumValues) {
    return typeof value === 'string' && enumValues.includes(value);
}

/**
 * Verifica se objeto tem propriedade obrigatória
 * @param {unknown} obj
 * @param {string[]} requiredProps
 * @returns {obj is Record<string, unknown>}
 */
export function hasRequiredProperties(obj, requiredProps) {
    if (!isObject(obj)) return false;
    return requiredProps.every(prop => prop in obj && obj[prop] !== undefined);
}

/**
 * Verifica se valor é um array não-vazio
 * @param {unknown} value
 * @returns {value is unknown[]}
 */
export function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Verifica se valor é uma data ISO válida
 * @param {unknown} value
 * @returns {value is string}
 */
export function isISODateString(value) {
    if (typeof value !== 'string') return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
}

/**
 * Verifica se valor é um status de task válido
 * @param {unknown} value
 * @returns {value is 'PENDING'|'RUNNING'|'DONE'|'FAILED'|'CANCELLED'|'PAUSED'}
 */
export function isTaskStatus(value) {
    const validStatuses = ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED', 'PAUSED'];
    return isValidEnum(value, validStatuses);
}

/**
 * Verifica se valor é um ActionCode válido
 * @param {unknown} value
 * @returns {value is string}
 */
export function isActionCode(value) {
    if (typeof value !== 'string') return false;
    return value.includes('_') && value === value.toUpperCase();
}

/**
 * Normaliza valor para string ou retorna padrão
 * @param {unknown} value
 * @param {string} defaultValue
 * @returns {string}
 */
export function toString(value, defaultValue = '') {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return defaultValue;
}

/**
 * Normaliza valor para número ou retorna padrão
 * @param {unknown} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function toNumber(value, defaultValue = 0) {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return Number.isFinite(num) ? num : defaultValue;
}

/**
 * Normaliza valor para booleano
 * @param {unknown} value
 * @returns {boolean}
 */
export function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes') return true;
        if (lower === 'false' || lower === '0' || lower === 'no') return false;
    }
    return Boolean(value);
}
