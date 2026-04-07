// @ts-check
/**
 * src/copilot/bridges/mcp-tool-schema.js
 *
 * Conversão de JSON Schema (MCP) para Zod schemas.
 * Suporta: escalares, enums, arrays, objetos aninhados recursivos, allOf/oneOf/anyOf.
 * Extraído de mcp-tool-bridge.js (F107) para reduzir complexidade.
 *
 * @module copilot/bridges/mcp-tool-schema
 */

import { z } from 'zod';

/**
 * Fragmento de JSON Schema usado para converter para Zod.
 *
 * @typedef {object} JsonSchemaFragment
 * @property {string} [type]
 * @property {string} [description]
 * @property {Record<string, JsonSchemaFragment>} [properties]
 * @property {string[]} [required]
 * @property {JsonSchemaFragment} [items]
 * @property {unknown[]} [enum]
 * @property {JsonSchemaFragment[]} [allOf]
 * @property {JsonSchemaFragment[]} [oneOf]
 * @property {JsonSchemaFragment[]} [anyOf]
 * @property {unknown} [default]
 */

/**
 * Constrói o schema Zod para um JSON Schema de uma tool MCP. Suporta: escalares, enums, arrays, objetos aninhados
 * recursivos.
 *
 * GAP-02 (fix): suporte a `enum` e `properties` aninhadas adicionado.
 *
 * @param {object} inputSchema - JSON Schema da tool (ou sub-schema de propriedade)
 * @param {Set<string>} [parentRequired] - conjunto de chaves obrigatórias do objeto pai
 * @param {string} [key] - chave desta propriedade no objeto pai
 * @returns {import('zod').ZodType} Schema Zod equivalente
 */
export function buildZodSchema(inputSchema, parentRequired, key) {
    /** @type {JsonSchemaFragment} */
    const schema = /** @type {JsonSchemaFragment} */ (inputSchema);

    if (!schema) return z.unknown();

    // FINDING-P4-1: allOf — merge de properties/required de todos os schemas
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
        if (schema.allOf.length === 1) {
            return buildZodSchema(/** @type {JsonSchemaFragment} */ (schema.allOf[0]), parentRequired, key);
        }
        /** @type {Record<string, object>} */
        const mergedProps = {};
        /** @type {string[]} */
        const mergedRequired = [];
        for (const s of schema.allOf) {
            const sub = /** @type {JsonSchemaFragment} */ (s);
            if (sub.properties) Object.assign(mergedProps, sub.properties);
            if (Array.isArray(sub.required)) mergedRequired.push(...sub.required);
        }
        return buildZodSchema(
            /** @type {JsonSchemaFragment} */ ({ type: 'object', properties: mergedProps, required: mergedRequired }),
            parentRequired,
            key,
        );
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        const options = schema.oneOf.map((/** @type {object} */ s) => buildZodSchema(s));
        const field = z.union(
            /** @type {[import('zod').ZodType, import('zod').ZodType, ...import('zod').ZodType[]]} */ (
                options.length >= 2 ? options : [options[0], z.unknown()]
            ),
        );
        return parentRequired && key && !parentRequired.has(key) ? field.optional() : field;
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        const options = schema.anyOf.map((/** @type {object} */ s) => buildZodSchema(s));
        const field = z.union(
            /** @type {[import('zod').ZodType, import('zod').ZodType, ...import('zod').ZodType[]]} */ (
                options.length >= 2 ? options : [options[0], z.unknown()]
            ),
        );
        return parentRequired && key && !parentRequired.has(key) ? field.optional() : field;
    }

    // GAP-02: enum (string literal union)
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        if (schema.enum.every((/** @type {unknown} */ v) => typeof v === 'string')) {
            const desc = schema.description ?? '';
            const baseEnum = z.enum(/** @type {[string, ...string[]]} */ (schema.enum));
            const field = desc ? baseEnum.describe(desc) : baseEnum;
            return parentRequired && key && !parentRequired.has(key) ? field.optional() : field;
        }
    }

    // Entry point: objeto com properties (inclui raiz e objetos aninhados)
    if (schema.type === 'object' || schema.properties) {
        if (!schema.properties) return z.record(z.string(), z.unknown());

        const required = new Set(/** @type {string[]} */ (schema.required ?? []));

        /** @type {Record<string, import('zod').ZodType>} */
        const shape = {};

        for (const [k, prop] of Object.entries(/** @type {Record<string, any>} */ (schema.properties))) {
            shape[k] = buildZodSchema(prop, required, k);
        }

        const obj = z.object(shape);
        if (parentRequired && key && !parentRequired.has(key)) return obj.optional();
        return obj;
    }

    const description = schema.description ?? '';

    /** @type {import('zod').ZodType} */
    let field;

    switch (schema.type) {
        case 'number':
        case 'integer':
            field = z.number().describe(description);
            break;
        case 'boolean':
            field = z.boolean().describe(description);
            break;
        case 'array': {
            const items = schema.items ? buildZodSchema(schema.items) : z.unknown();
            field = z.array(items).describe(description);
            break;
        }
        default:
            field = z.string().describe(description);
    }

    if (parentRequired && key && !parentRequired.has(key)) return field.optional();
    return field;
}
