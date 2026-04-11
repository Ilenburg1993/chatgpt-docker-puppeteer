// @ts-check
/**
 * src/copilot/sdk/tools.js
 *
 * Faixa 2 / F6 — Wrapper centralizado para criação de tools via `@github/copilot-sdk`. Ponto único de acesso ao
 * `defineTool` do SDK; consumers **não** devem importar `defineTool` diretamente do `@github/copilot-sdk`.
 *
 * Exports:
 *
 * - `createTool()` — factory padrão com logging, normalização Zod e defaults do projeto
 * - `defineTool` — re-export do SDK (apenas para edge cases e compat)
 *
 * Para a registry de tools em runtime, ver `sdk/tools-registry.js`. Para a factory existente com convenções avançadas,
 * ver `tools/tool-factory.js`.
 *
 * @module copilot/sdk/tools
 * @see EventBus
 * @see module:copilot/sdk/tools-registry
 */

import { defineTool } from '@github/copilot-sdk';
import { log } from './logger.js';

/** @type {typeof import('zod-to-json-schema').zodToJsonSchema | null} */
let _zodToJsonSchema = null;

try {
    const mod = await import('zod-to-json-schema');
    _zodToJsonSchema = mod.zodToJsonSchema;
} catch {
    // zod-to-json-schema não disponível — tools com JSON Schema manual continuam funcionando
}

// Re-export do SDK para compat — consumers preferem usar createTool()
export { defineTool };

/**
 * @template [T=unknown] Default is `unknown`
 * @typedef {object} CreateToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case)
 * @property {string} description - Descrição legível para o modelo
 * @property {any} [parameters] - Zod schema (ZodTypeAny/ZodSchema) ou JSON Schema plano (Record<string, unknown>)
 * @property {import('@github/copilot-sdk').ToolHandler<T> | ((...args: any[]) => any)} handler - Callback executor
 * @property {boolean} [skipPermission=false] - Pular verificação de permissão (default: false). Default is `false`
 * @property {boolean} [overridesBuiltInTool=false] - Sobrescreve tool nativa do SDK. Default is `false`
 */

/**
 * Tenta converter um schema Zod para JSON Schema. Retorna `undefined` se a conversão falhar ou o input não for Zod.
 *
 * @param {import('zod/v3').ZodTypeAny | Record<string, unknown> | undefined} schema
 * @returns {Record<string, unknown> | undefined}
 */
function tryZodToJsonSchema(schema) {
    if (!schema) return undefined;

    // Detecta Zod v3 (`_def`) ou v4 (`_zod`)
    const isZod = '_def' in schema || '_zod' in schema;
    if (!isZod) return /** @type {Record<string, unknown>} */ (schema);

    if (!_zodToJsonSchema) {
        log('WARN', '[sdk/tools] zod-to-json-schema não disponível, ignorando conversão Zod');
        return undefined;
    }

    try {
        return /** @type {Record<string, unknown>} */ (
            _zodToJsonSchema(/** @type {import('zod/v3').ZodTypeAny} */ (schema))
        );
    } catch (err) {
        log('WARN', `[sdk/tools] Falha ao converter Zod schema: ${/** @type {Error} */ (err).message}`);
        return undefined;
    }
}

/**
 * Cria uma Custom Tool via SDK `defineTool`, com logging de invocação e normalização automática de Zod schemas.
 *
 * @example
 *     ```js
 *     import { createTool } from '#copilot/sdk/tools';
 *     import { z } from 'zod/v3';
 *
 *     const readFileTool = createTool({
 *         name: 'read_file',
 *         description: 'Lê conteúdo de um arquivo',
 *         parameters: z.object({ path: z.string() }),
 *         handler: async ({ path }) => readFileSync(path, 'utf8'),
 *     });
 *     ```;
 *
 * @template [T=unknown] Default is `unknown`
 * @param {CreateToolOptions<T>} options
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
export function createTool({
    name,
    description,
    parameters,
    handler,
    skipPermission = false,
    overridesBuiltInTool = false,
}) {
    if (!name || typeof name !== 'string') {
        throw new TypeError('[sdk/tools] createTool: name (string) é obrigatório');
    }
    if (!handler || typeof handler !== 'function') {
        throw new TypeError('[sdk/tools] createTool: handler (function) é obrigatório');
    }

    const jsonSchema = tryZodToJsonSchema(parameters);

    /** @type {import('@github/copilot-sdk').ToolHandler<T>} */
    const wrappedHandler = async (args, invocation) => {
        log('DEBUG', `[sdk/tools] Invocando '${name}' (session=${invocation?.sessionId ?? 'n/a'})`);
        return handler(args, invocation);
    };

    return defineTool(name, {
        description,
        ...(jsonSchema !== undefined ? { parameters: jsonSchema } : {}),
        handler: wrappedHandler,
        skipPermission,
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}

/**
 * Cria uma tool síncrona (sem async no handler) — variante de conveniência.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {Omit<CreateToolOptions<T>, 'parameters'> & { parameters?: Record<string, unknown> }} options
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
export function createToolSync({
    name,
    description,
    parameters,
    handler,
    skipPermission = false,
    overridesBuiltInTool = false,
}) {
    if (!name || typeof name !== 'string') {
        throw new TypeError('[sdk/tools] createToolSync: name (string) é obrigatório');
    }
    if (!handler || typeof handler !== 'function') {
        throw new TypeError('[sdk/tools] createToolSync: handler (function) é obrigatório');
    }

    /** @type {import('@github/copilot-sdk').ToolHandler<T>} */
    const wrappedHandler = async (args, invocation) => {
        log('DEBUG', `[sdk/tools] Invocando '${name}' (session=${invocation?.sessionId ?? 'n/a'})`);
        return handler(args, invocation);
    };

    return defineTool(name, {
        description,
        ...(parameters !== undefined ? { parameters } : {}),
        handler: wrappedHandler,
        skipPermission,
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}
