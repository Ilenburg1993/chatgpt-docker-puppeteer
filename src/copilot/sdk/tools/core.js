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
import { createRequire } from 'node:module';
import { log } from '../logger.js';

/**
 * Estado hoist-safe para ciclos ESM. `createTool()` pode ser chamado durante a avaliação circular de módulos de tools;
 * propriedades em função evitam TDZ.
 *
 * @returns {{ converter: typeof import('zod-to-json-schema').zodToJsonSchema | null; attempted: boolean }}
 */
function getZodConverterState() {
    const fn = /**
     * @type {typeof getZodConverterState & {
     *     _state?: { converter: typeof import('zod-to-json-schema').zodToJsonSchema | null; attempted: boolean };
     * }}
     */ (getZodConverterState);
    if (!fn._state) {
        fn._state = { converter: null, attempted: false };
    }
    return fn._state;
}

/**
 * Carrega o conversor sob demanda. Isso evita falhas de boot em ciclos ESM onde `createTool()` pode ser chamado antes
 * de este módulo terminar sua avaliação.
 *
 * @returns {typeof import('zod-to-json-schema').zodToJsonSchema | null}
 */
function loadZodToJsonSchema() {
    const state = getZodConverterState();
    if (state.converter || state.attempted) return state.converter;
    state.attempted = true;
    try {
        const requireFromHere = createRequire(import.meta.url);
        const mod = requireFromHere('zod-to-json-schema');
        state.converter = mod.zodToJsonSchema ?? mod.default ?? null;
    } catch {
        // zod-to-json-schema não disponível — tools com JSON Schema manual continuam funcionando
    }
    return state.converter;
}

/**
 * Converte Zod v4 pela API nativa do pacote `zod`. O conversor `zod-to-json-schema` cobre Zod v3, mas em v4 pode gerar
 * schema vazio, o que deixa a tool praticamente invisível para o modelo.
 *
 * @param {import('zod/v3').ZodTypeAny | Record<string, unknown>} schema
 * @returns {Record<string, unknown> | undefined}
 */
function tryZodV4ToJsonSchema(schema) {
    if (!schema || !('_zod' in schema)) return undefined;
    try {
        const requireFromHere = createRequire(import.meta.url);
        const mod = requireFromHere('zod');
        const toJSONSchema =
            typeof mod?.z?.toJSONSchema === 'function'
                ? mod.z.toJSONSchema
                : typeof mod?.toJSONSchema === 'function'
                  ? mod.toJSONSchema
                  : null;
        if (!toJSONSchema) return undefined;
        return /** @type {Record<string, unknown>} */ (toJSONSchema(schema));
    } catch {
        return undefined;
    }
}

/**
 * Valida se o JSON Schema gerado possui estrutura útil para parâmetros de tool.
 *
 * @param {unknown} schema
 * @returns {schema is Record<string, unknown>}
 */
function isUsableToolParameterSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
    const data = /** @type {Record<string, unknown>} */ (schema);
    if (typeof data['type'] === 'string') return true;
    if (typeof data['$ref'] === 'string') return true;
    if (data['properties'] && typeof data['properties'] === 'object') return true;
    if (Array.isArray(data['anyOf']) || Array.isArray(data['oneOf']) || Array.isArray(data['allOf'])) return true;
    if ('additionalProperties' in data) return true;
    return false;
}

// Re-export do SDK para compat — consumers preferem usar createTool()
export { defineTool };

/**
 * @template [T=unknown] Default is `unknown`
 * @typedef {object} CreateToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case)
 * @property {string} description - Descrição legível para o modelo
 * @property {any} [parameters] - Zod schema (ZodTypeAny/ZodSchema) ou JSON Schema plano (Record<string, unknown>)
 * @property {import('@github/copilot-sdk').ToolHandler<T>
 *     | ((args: T, invocation?: unknown) => Promise<unknown> | unknown)} handler
 *   - Callback executor
 *
 * @property {boolean} [skipPermission=false] - Pular verificação de permissão (default: false). Default is `false`
 * @property {boolean} [overridesBuiltInTool=false] - Sobrescreve tool nativa do SDK. Default is `false`
 */

/**
 * Tenta converter um schema Zod para JSON Schema. Retorna `undefined` se a conversão falhar ou o input não for Zod.
 *
 * @param {import('zod/v3').ZodTypeAny | Record<string, unknown> | undefined} schema
 * @param {string} toolName
 * @returns {Record<string, unknown> | undefined}
 */
function tryZodToJsonSchema(schema, toolName) {
    if (!schema) return undefined;

    // Detecta Zod v3 (`_def`) ou v4 (`_zod`)
    const isZod = '_def' in schema || '_zod' in schema;
    if (!isZod) return /** @type {Record<string, unknown>} */ (schema);

    const zodV4Schema = tryZodV4ToJsonSchema(schema);
    if (isUsableToolParameterSchema(zodV4Schema)) return zodV4Schema;

    const converter = loadZodToJsonSchema();
    if (!converter) {
        const maybeJsonSchema = /** @type {{ toJSONSchema?: () => Record<string, unknown> }} */ (schema);
        if (typeof maybeJsonSchema.toJSONSchema === 'function') {
            const manual = maybeJsonSchema.toJSONSchema();
            if (isUsableToolParameterSchema(manual)) return manual;
            log('WARN', `[sdk/tools] Schema inválido para '${toolName}' após toJSONSchema(); usando sem parâmetros.`);
            return undefined;
        }
        log(
            'WARN',
            `[sdk/tools] Tool '${toolName}' usa Zod schema mas 'zod-to-json-schema' não está disponível. ` +
                'Tool será registrada sem parâmetros.',
        );
        return undefined;
    }

    try {
        const converted = /** @type {Record<string, unknown>} */ (
            converter(/** @type {import('zod/v3').ZodTypeAny} */ (schema))
        );
        if (!isUsableToolParameterSchema(converted)) {
            log(
                'WARN',
                `[sdk/tools] Schema convertido inválido para '${toolName}' (provável fallback raso); usando sem parâmetros.`,
            );
            return undefined;
        }
        return converted;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('WARN', `[sdk/tools] Falha ao converter Zod schema da tool '${toolName}': ${message}`);
        return undefined;
    }
}

/**
 * Cria a forma mínima de Tool quando o SDK externo está mockado de forma parcial em testes.
 *
 * @template T
 * @param {string} name
 * @param {{
 *     description: string;
 *     parameters?: Record<string, unknown>;
 *     handler: import('@github/copilot-sdk').ToolHandler<T>;
 *     skipPermission?: boolean;
 *     overridesBuiltInTool?: boolean;
 * }} config
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
function makePlainSdkTool(name, config) {
    return /** @type {import('@github/copilot-sdk').Tool<T>} */ ({ name, ...config });
}

/**
 * Chama `defineTool` do SDK com fallback apenas para mocks incompletos.
 *
 * @template T
 * @param {string} name
 * @param {{
 *     description: string;
 *     parameters?: Record<string, unknown>;
 *     handler: import('@github/copilot-sdk').ToolHandler<T>;
 *     skipPermission?: boolean;
 *     overridesBuiltInTool?: boolean;
 * }} config
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
function defineToolSafe(name, config) {
    try {
        const tool = defineTool(name, config);
        return tool && typeof tool === 'object' ? tool : makePlainSdkTool(name, config);
    } catch (err) {
        if (err instanceof Error && /defineTool.*export|No "defineTool" export/i.test(err.message)) {
            return makePlainSdkTool(name, config);
        }
        throw err;
    }
}

/**
 * Cria uma Custom Tool via SDK `defineTool`, com logging de invocação e normalização automática de Zod schemas.
 *
 * @example
 *     ```js
 *     import { createTool } from '#copilot/sdk';
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

    const jsonSchema = tryZodToJsonSchema(parameters, name);

    /** @type {import('@github/copilot-sdk').ToolHandler<T>} */
    const wrappedHandler = async (args, invocation) => {
        log('DEBUG', `[sdk/tools] Invocando '${name}' (session=${invocation?.sessionId ?? 'n/a'})`);
        return handler(args, invocation);
    };

    return defineToolSafe(name, {
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

    const jsonSchema = tryZodToJsonSchema(parameters, name);

    return defineToolSafe(name, {
        description,
        ...(jsonSchema !== undefined ? { parameters: jsonSchema } : {}),
        handler: wrappedHandler,
        skipPermission,
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}
