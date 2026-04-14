// @ts-check
/**
 * src/copilot/core/safe-json.js
 *
 * F88: Helper para parse seguro de JSON com erro tipado.
 *
 * @module copilot/core/safe-json
 * @see EventBus
 */

import { toError } from './error-handlers.js';
import { ValidationError } from './errors.js';

/**
 * Parse seguro de JSON. Retorna `{ ok: true, data }` ou `{ ok: false, error }`.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {string} raw - String JSON a parsear.
 * @param {string} [context] - Contexto descritivo para a mensagem de erro.
 * @returns {{ ok: true; data: T } | { ok: false; error: ValidationError }}
 */
export function safeJsonParse(raw, context) {
    try {
        return { ok: true, data: /** @type {T} */ (JSON.parse(raw)) };
    } catch (e) {
        const msg = context
            ? `[safeJsonParse] Falha ao parsear JSON (${context}): ${toError(e).message}`
            : `[safeJsonParse] Falha ao parsear JSON: ${toError(e).message}`;
        return { ok: false, error: new ValidationError(msg, 'JSON_PARSE_ERROR') };
    }
}

/**
 * Parse de JSON que lança `ValidationError` em caso de falha.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {string} raw - String JSON a parsear.
 * @param {string} [context] - Contexto descritivo para a mensagem de erro.
 * @returns {T}
 * @throws {ValidationError} Se o JSON for inválido.
 */
export function parseJsonOrThrow(raw, context) {
    const result = safeJsonParse(raw, context);
    if (!result.ok) throw result.error;
    return /** @type {T} */ (result.data);
}

/**
 * Stringify seguro de JSON. Nunca lança — retorna `'{}'` em caso de falha (ex: referência circular, BigInt sem
 * serializer).
 *
 * @param {unknown} value - Valor a serializar.
 * @param {number} [indent] - Espaços de indentação (0 = compact).
 * @returns {string}
 */
export function safeJsonStringify(value, indent) {
    try {
        return JSON.stringify(value, null, indent);
    } catch {
        return '{}';
    }
}
