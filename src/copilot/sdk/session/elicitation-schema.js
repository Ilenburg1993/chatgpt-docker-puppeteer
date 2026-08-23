// @ts-check
/**
 * @module copilot/sdk/session/elicitation-schema
 * @file Normalização/validação do subconjunto JSON Schema aceito pela elicitation do SDK.
 *
 *   Não implementa JSON Schema completo. O subconjunto suportado é deliberadamente estrito: tipos primitivos, enum,
 *   oneOf/anyOf, arrays de strings, constraints simples, formatos conhecidos e defaults top-level validados.
 */

/**
 * @typedef {string | number | boolean | string[]} RuntimeElicitationFieldValue
 *
 * @typedef {import('../types.js').ElicitationResult} RuntimeElicitationResult
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectOrNull(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} value
 * @returns {value is RuntimeElicitationFieldValue}
 */
export function isRuntimeElicitationFieldValue(value) {
    if (typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * @param {unknown} schema
 * @returns {schema is { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }}
 */
export function isRuntimeElicitationSchema(schema) {
    const obj = objectOrNull(schema);
    return obj?.['type'] === 'object' && objectOrNull(obj['properties']) !== null;
}

/**
 * @param {unknown} value
 * @returns {RuntimeElicitationFieldValue | undefined}
 */
function cloneRuntimeFieldValue(value) {
    if (!isRuntimeElicitationFieldValue(value)) return undefined;
    return Array.isArray(value) ? [...value] : value;
}

/**
 * @param {Record<string, unknown>} fieldObj
 * @param {RuntimeElicitationFieldValue} value
 * @returns {boolean}
 */
function matchesSchemaType(fieldObj, value) {
    const type = fieldObj['type'];
    if (!type) return true;
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number';
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'array') return Array.isArray(value);
    return false;
}

/**
 * @param {unknown} value
 * @param {unknown[]} variants
 * @param {'anyOf'|'oneOf'} mode
 * @returns {boolean}
 */
function matchesVariants(value, variants, mode) {
    let matches = 0;
    for (const variant of variants) {
        const schema = objectOrNull(variant);
        if (!schema) continue;
        const matched =
            'const' in schema
                ? Object.is(value, schema['const'])
                : Array.isArray(schema['enum'])
                  ? schema['enum'].includes(value)
                  : isRuntimeElicitationFieldValue(value) && matchesSchemaType(schema, value);
        if (matched) matches += 1;
    }
    return mode === 'oneOf' ? matches === 1 : matches >= 1;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {string} value
 * @param {unknown} format
 * @returns {boolean}
 */
function matchesStringFormat(value, format) {
    if (format === 'email') {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    if (format === 'uri') {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    }
    if (format === 'date') {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) return false;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1) return false;
        const date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    }
    if (format === 'date-time') {
        return Number.isFinite(Date.parse(value));
    }
    return true;
}

/**
 * @param {string} key
 * @param {string[]} value
 * @param {Record<string, unknown>} fieldObj
 * @returns {{ ok: true } | { ok: false; error: string }}
 */
function validateArrayField(key, value, fieldObj) {
    const minItems = finiteNumberOrNull(fieldObj['minItems']);
    if (minItems !== null && value.length < minItems) {
        return { ok: false, error: `Campo "${key}" deve ter ao menos ${minItems} item(ns).` };
    }
    const maxItems = finiteNumberOrNull(fieldObj['maxItems']);
    if (maxItems !== null && value.length > maxItems) {
        return { ok: false, error: `Campo "${key}" deve ter no maximo ${maxItems} item(ns).` };
    }

    const items = objectOrNull(fieldObj['items']);
    if (!items) return { ok: true };

    if (items['type'] && items['type'] !== 'string') {
        return { ok: false, error: `Campo "${key}" suporta apenas arrays de string nesta borda.` };
    }

    if (Array.isArray(items['enum'])) {
        const allowed = /** @type {unknown[]} */ (items['enum']);
        const invalid = value.find((item) => !allowed.includes(item));
        if (invalid !== undefined) {
            return {
                ok: false,
                error: `Campo "${key}" deve usar apenas valores: ${allowed.map((entry) => String(entry)).join(' | ')}.`,
            };
        }
    }

    const variantMode = Array.isArray(items['oneOf']) ? 'oneOf' : Array.isArray(items['anyOf']) ? 'anyOf' : null;
    const variants = variantMode ? /** @type {unknown[]} */ (items[variantMode]) : null;
    if (variants && variantMode && value.some((item) => !matchesVariants(item, variants, variantMode))) {
        const allowed = variants
            .flatMap((variant) => {
                const obj = objectOrNull(variant);
                if (!obj) return [];
                if ('const' in obj) return [String(obj['const'])];
                if (Array.isArray(obj['enum'])) return obj['enum'].map((entry) => String(entry));
                return [];
            })
            .filter(Boolean);
        return {
            ok: false,
            error:
                allowed.length > 0
                    ? `Campo "${key}" deve usar apenas valores: ${allowed.join(' | ')}.`
                    : `Campo "${key}" contém item fora do anyOf/oneOf permitido.`,
        };
    }

    return { ok: true };
}

/**
 * @param {string} key
 * @param {RuntimeElicitationFieldValue} value
 * @param {Record<string, unknown>} fieldObj
 * @returns {{ ok: true } | { ok: false; error: string }}
 */
function validateFieldAgainstSchema(key, value, fieldObj) {
    if (!matchesSchemaType(fieldObj, value)) {
        const type = String(fieldObj['type'] ?? 'valor válido');
        return { ok: false, error: `Campo "${key}" deve ser ${type}.` };
    }

    if (Array.isArray(fieldObj['enum']) && !fieldObj['enum'].includes(value)) {
        return { ok: false, error: `Campo "${key}" deve ser uma das opções: ${fieldObj['enum'].join(' | ')}.` };
    }

    const variantMode = Array.isArray(fieldObj['oneOf']) ? 'oneOf' : Array.isArray(fieldObj['anyOf']) ? 'anyOf' : null;
    const variants = variantMode ? /** @type {unknown[]} */ (fieldObj[variantMode]) : null;
    if (variants && variantMode && !matchesVariants(value, variants, variantMode)) {
        const allowed = variants
            .flatMap((variant) => {
                const obj = objectOrNull(variant);
                if (!obj) return [];
                if ('const' in obj) return [String(obj['const'])];
                if (Array.isArray(obj['enum'])) return obj['enum'].map((entry) => String(entry));
                return [];
            })
            .filter(Boolean);
        return {
            ok: false,
            error:
                allowed.length > 0
                    ? `Campo "${key}" deve ser uma das opções: ${allowed.join(' | ')}.`
                    : `Campo "${key}" não corresponde ao anyOf/oneOf permitido.`,
        };
    }

    if (Array.isArray(value)) {
        return validateArrayField(key, value, fieldObj);
    }

    if (typeof value === 'string') {
        const minLength = finiteNumberOrNull(fieldObj['minLength']);
        if (minLength !== null && value.length < minLength) {
            return { ok: false, error: `Campo "${key}" deve ter ao menos ${minLength} caractere(s).` };
        }
        const maxLength = finiteNumberOrNull(fieldObj['maxLength']);
        if (maxLength !== null && value.length > maxLength) {
            return { ok: false, error: `Campo "${key}" deve ter no maximo ${maxLength} caractere(s).` };
        }
        if (!matchesStringFormat(value, fieldObj['format'])) {
            return { ok: false, error: `Campo "${key}" deve respeitar o formato ${String(fieldObj['format'])}.` };
        }
    }

    if (typeof value === 'number') {
        const minimum = finiteNumberOrNull(fieldObj['minimum']);
        if (minimum !== null && value < minimum) {
            return { ok: false, error: `Campo "${key}" deve ser maior ou igual a ${minimum}.` };
        }
        const maximum = finiteNumberOrNull(fieldObj['maximum']);
        if (maximum !== null && value > maximum) {
            return { ok: false, error: `Campo "${key}" deve ser menor ou igual a ${maximum}.` };
        }
    }

    return { ok: true };
}

/**
 * @param {Record<string, RuntimeElicitationFieldValue> | undefined} content
 * @param {unknown} schema
 * @returns {{ ok: true; content: Record<string, RuntimeElicitationFieldValue> | undefined } | { ok: false; error: string }}
 */
export function normalizeElicitationContentWithSchema(content, schema) {
    /** @type {Record<string, RuntimeElicitationFieldValue>} */
    const normalized = {};
    if (content) {
        for (const [key, value] of Object.entries(content)) {
            if (!isRuntimeElicitationFieldValue(value)) {
                return { ok: false, error: `Campo "${key}" deve ser string, number, boolean ou string[].` };
            }
            normalized[key] = Array.isArray(value) ? [...value] : value;
        }
    }

    if (!isRuntimeElicitationSchema(schema)) {
        return { ok: true, content: Object.keys(normalized).length > 0 ? normalized : undefined };
    }

    for (const [key, field] of Object.entries(schema.properties)) {
        if (key in normalized) continue;
        const fieldObj = objectOrNull(field);
        if (!fieldObj || !('default' in fieldObj)) continue;
        const cloned = cloneRuntimeFieldValue(fieldObj['default']);
        if (cloned === undefined) {
            return { ok: false, error: `Default inválido para o campo "${key}".` };
        }
        normalized[key] = cloned;
    }

    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
        if (!(key in normalized)) return { ok: false, error: `Campo obrigatório ausente: "${key}".` };
    }

    if (schema.additionalProperties === false) {
        for (const key of Object.keys(normalized)) {
            if (!(key in schema.properties)) return { ok: false, error: `Campo não permitido pelo schema: "${key}".` };
        }
    }

    for (const [key, value] of Object.entries(normalized)) {
        const fieldObj = objectOrNull(schema.properties[key]);
        if (!fieldObj) continue;
        const validation = validateFieldAgainstSchema(key, value, fieldObj);
        if (!validation.ok) return validation;
    }
    return { ok: true, content: Object.keys(normalized).length > 0 ? normalized : undefined };
}

/**
 * @param {unknown} value
 * @param {unknown} schema
 * @param {{ context?: string }} [options]
 * @returns {RuntimeElicitationResult}
 */
export function normalizeElicitationResultWithSchema(value, schema, options = {}) {
    const context = options.context ?? '[elicitation-schema]';
    const raw = objectOrNull(value);
    const action = raw?.['action'];

    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
        throw new TypeError(`${context} result.action deve ser accept | decline | cancel.`);
    }

    const contentRaw = raw?.['content'];
    if (action !== 'accept' && contentRaw !== undefined) {
        throw new TypeError(`${context} result.content só pode ser enviado com action=accept.`);
    }
    if (contentRaw !== undefined && (!contentRaw || typeof contentRaw !== 'object' || Array.isArray(contentRaw))) {
        throw new TypeError(`${context} result.content deve ser um objeto quando fornecido.`);
    }
    if (action !== 'accept') return { action };

    const normalized = normalizeElicitationContentWithSchema(
        contentRaw
            ? /** @type {Record<string, RuntimeElicitationFieldValue>} */ (/** @type {unknown} */ (contentRaw))
            : undefined,
        schema,
    );
    if (!normalized.ok) {
        throw new TypeError(`${context} ${normalized.error}`);
    }
    return { action, ...(normalized.content ? { content: normalized.content } : {}) };
}
