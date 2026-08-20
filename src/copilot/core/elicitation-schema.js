// @ts-check
/**
 * @module copilot/core/elicitation-schema
 * @file Normalização/validação leve de conteúdo de elicitation.
 *
 *   Não implementa JSON Schema completo; cobre o subconjunto operacional usado pelas bordas do projeto: tipos primitivos,
 *   enum/oneOf/anyOf simples, arrays de strings e defaults top-level.
 */

/**
 * @typedef {import('../presentation/contracts/index.js').RuntimeElicitationFieldValue} RuntimeElicitationFieldValue
 *
 * @typedef {import('../presentation/contracts/index.js').RuntimeElicitationResult} RuntimeElicitationResult
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
 * @returns {schema is { type: 'object'; properties: Record<string, unknown>; required?: string[] }}
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
    return true;
}

/**
 * @param {unknown} value
 * @param {unknown[]} variants
 * @returns {boolean}
 */
function matchesVariant(value, variants) {
    return variants.some((variant) => {
        const schema = objectOrNull(variant);
        if (!schema) return false;
        if ('const' in schema) return Object.is(value, schema['const']);
        if (Array.isArray(schema['enum'])) return schema['enum'].includes(value);
        return matchesSchemaType(schema, /** @type {RuntimeElicitationFieldValue} */ (value));
    });
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const parsed = Date.parse(`${value}T00:00:00.000Z`);
        return Number.isFinite(parsed);
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

    const variants = Array.isArray(items['anyOf'])
        ? items['anyOf']
        : Array.isArray(items['oneOf'])
          ? items['oneOf']
          : null;
    if (variants && value.some((item) => !matchesVariant(item, variants))) {
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

    const variants = Array.isArray(fieldObj['anyOf'])
        ? fieldObj['anyOf']
        : Array.isArray(fieldObj['oneOf'])
          ? fieldObj['oneOf']
          : null;
    if (variants && !matchesVariant(value, variants)) {
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
    if (!content) {
        if (!isRuntimeElicitationSchema(schema)) return { ok: true, content: undefined };
        /** @type {Record<string, RuntimeElicitationFieldValue>} */
        const defaultsOnly = {};
        for (const [key, field] of Object.entries(schema.properties)) {
            const fieldObj = objectOrNull(field);
            if (!fieldObj || !('default' in fieldObj)) continue;
            const cloned = cloneRuntimeFieldValue(fieldObj['default']);
            if (cloned !== undefined) defaultsOnly[key] = cloned;
        }
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const key of required) {
            if (!(key in defaultsOnly)) {
                return { ok: false, error: `Campo obrigatório ausente: "${key}".` };
            }
        }
        return { ok: true, content: Object.keys(defaultsOnly).length > 0 ? defaultsOnly : undefined };
    }

    /** @type {Record<string, RuntimeElicitationFieldValue>} */
    const normalized = {};
    for (const [key, value] of Object.entries(content)) {
        if (!isRuntimeElicitationFieldValue(value)) {
            return { ok: false, error: `Campo "${key}" deve ser string, number, boolean ou string[].` };
        }
        normalized[key] = Array.isArray(value) ? [...value] : value;
    }

    if (!isRuntimeElicitationSchema(schema)) {
        return { ok: true, content: Object.keys(normalized).length > 0 ? normalized : undefined };
    }

    for (const [key, field] of Object.entries(schema.properties)) {
        if (key in normalized) continue;
        const fieldObj = objectOrNull(field);
        if (!fieldObj || !('default' in fieldObj)) continue;
        const cloned = cloneRuntimeFieldValue(fieldObj['default']);
        if (cloned !== undefined) normalized[key] = cloned;
    }

    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
        if (!(key in normalized)) {
            return { ok: false, error: `Campo obrigatório ausente: "${key}".` };
        }
    }

    for (const [key, field] of Object.entries(schema.properties)) {
        if (!(key in normalized)) continue;
        const fieldObj = objectOrNull(field);
        if (!fieldObj) continue;
        const value = normalized[key];
        if (value === undefined) continue;
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
