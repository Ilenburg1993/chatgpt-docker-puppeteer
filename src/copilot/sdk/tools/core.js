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
 * - `defineTool` — primitive vanilla do SDK exposta para integrações que precisam controlar a factory diretamente
 *
 * Para a registry de tools em runtime, ver `sdk/tools/registry.js`. Para a factory de aplicação com convenções
 * avançadas, ver `tools/infra/tool-factory.js`.
 *
 * @module copilot/sdk/tools
 * @see EventBus
 * @see module:copilot/sdk/tools/registry
 */

import { toError } from '#copilot/infra/public/platform/error';
import { BuiltInTools, ToolSet, convertMcpCallToolResult, defineTool } from '@github/copilot-sdk';
import { createRequire } from 'node:module';
import { log } from '../logger.js';

/**
 * Entrada aceita para parâmetros de tool: schema Zod/Zod-like ou JSON Schema plano.
 *
 * @template [T=unknown] Default is `unknown`
 * @typedef {import('zod').ZodType
 *     | import('zod/v3').ZodTypeAny
 *     | import('@github/copilot-sdk').ZodSchema<T>
 *     | Record<string, unknown>} ToolParameterInput
 */

/**
 * Executable local tool. Unlike the SDK's declaration-capable `Tool`, project factories guarantee a handler at runtime.
 * The wrapper is async even when the source callback is synchronous, so callers have one stable invocation contract.
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @template [TResult=unknown] Default is `unknown`
 * @typedef {Omit<import('@github/copilot-sdk').Tool<TArgs>, 'handler'> & {
 *     handler: (args: TArgs, invocation?: import('@github/copilot-sdk').ToolInvocation) => Promise<TResult>;
 * }} ExecutableTool
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecordObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Structural type for the optional `zod-to-json-schema` fallback. Keeping this local is intentional: the package is
 * loaded opportunistically at runtime and must not become a static TypeScript/package dependency solely through JSDoc.
 *
 * @typedef {(schema: import('zod/v3').ZodTypeAny, options?: unknown) => unknown} ZodToJsonSchemaConverter
 */

/**
 * Estado hoist-safe para ciclos ESM. `createTool()` pode ser chamado durante a avaliação circular de módulos de tools;
 * propriedades em função evitam TDZ.
 *
 * @returns {{ converter: ZodToJsonSchemaConverter | null; attempted: boolean }}
 */
function getZodConverterState() {
    const fn =
        /**
         * @type {typeof getZodConverterState & {
         *     _state?: { converter: ZodToJsonSchemaConverter | null; attempted: boolean };
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
 * @returns {ZodToJsonSchemaConverter | null}
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

/**
 * Heurística defensiva para detectar schemas Zod/Zod-like sem confundir objetos literais com `_def` arbitrário.
 *
 * @param {unknown} schema
 * @returns {schema is ToolParameterInput}
 */
function isLikelyZodSchema(schema) {
    if (!isRecordObject(schema)) return false;
    return (
        typeof schema['safeParse'] === 'function' ||
        typeof schema['parse'] === 'function' ||
        typeof schema['toJSONSchema'] === 'function' ||
        (!!schema['_def'] && typeof schema['_def'] === 'object') ||
        (!!schema['_zod'] && typeof schema['_zod'] === 'object')
    );
}

/**
 * Tenta usar a API direta `toJSONSchema()` quando disponível.
 *
 * @param {ToolParameterInput} schema
 * @returns {Record<string, unknown> | undefined}
 */
function tryDirectToJsonSchema(schema) {
    const schemaRecord = /** @type {Record<string, unknown>} */ (schema);
    if (typeof schemaRecord['toJSONSchema'] !== 'function') return undefined;
    try {
        const jsonSchema = /** @type {() => unknown} */ (schemaRecord['toJSONSchema'])();
        return isUsableToolParameterSchema(jsonSchema) ? jsonSchema : undefined;
    } catch {
        return undefined;
    }
}

// Primitives vanilla para integrações de baixo nível; consumers comuns preferem as factories locais.
export { BuiltInTools, ToolSet, convertMcpCallToolResult, defineTool };

/**
 * @template [T=unknown] Default is `unknown`
 * @template [TResult=unknown] Default is `unknown`
 * @typedef {object} CreateToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case)
 * @property {string} description - Descrição legível para o modelo
 * @property {ToolParameterInput<T>} [parameters] - Zod schema (ZodType/ZodSchema) ou JSON Schema plano
 * @property {(args: T, invocation?: import('@github/copilot-sdk').ToolInvocation) => Promise<TResult> | TResult} handler
 *   - Callback executor
 *
 * @property {boolean} [skipPermission=false] - Pular verificação de permissão (default: false). Default is `false`
 * @property {boolean} [overridesBuiltInTool=false] - Sobrescreve tool nativa do SDK. Default is `false`
 */

/**
 * @template [T=unknown] Default is `unknown`
 * @typedef {object} CreateDeclarationToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case)
 * @property {string} description - Descrição legível para o modelo
 * @property {ToolParameterInput<T>} [parameters] - Zod schema (ZodType/ZodSchema) ou JSON Schema plano
 * @property {boolean} [skipPermission=false] - Pular verificação de permissão (default: false). Default is `false`
 * @property {boolean} [overridesBuiltInTool=false] - Sobrescreve tool nativa do SDK. Default is `false`
 */

/**
 * Tenta converter um schema Zod para JSON Schema. Retorna `undefined` se a conversão falhar ou o input não for Zod.
 *
 * @param {ToolParameterInput | undefined} schema
 * @param {string} toolName
 * @returns {Record<string, unknown> | undefined}
 */
function tryZodToJsonSchema(schema, toolName) {
    if (!schema) return undefined;
    if (!isRecordObject(schema)) return undefined;

    if (!isLikelyZodSchema(schema)) {
        return isUsableToolParameterSchema(schema) ? schema : undefined;
    }

    const directJsonSchema = tryDirectToJsonSchema(schema);
    if (isUsableToolParameterSchema(directJsonSchema)) return directJsonSchema;

    const zodV4Schema = tryZodV4ToJsonSchema(schema);
    if (isUsableToolParameterSchema(zodV4Schema)) return zodV4Schema;

    const converter = loadZodToJsonSchema();
    if (!converter) {
        const schemaRecord = /** @type {Record<string, unknown>} */ (schema);
        if (typeof schemaRecord['toJSONSchema'] === 'function') {
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
            converter(/** @type {import('zod/v3').ZodTypeAny} */ (/** @type {unknown} */ (schema)))
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
        const message = toError(err).message;
        log('WARN', `[sdk/tools] Falha ao converter Zod schema da tool '${toolName}': ${message}`);
        return undefined;
    }
}

/**
 * Normaliza parâmetros de tool para JSON Schema utilizável pelo SDK.
 *
 * Fonte canônica para `src/copilot/sdk/tools/*` e `src/copilot/tools/infra/tool-factory.js`, evitando lógica paralela
 * de detecção/conversão de schema.
 *
 * @param {ToolParameterInput | undefined} parameters
 * @param {string} toolName
 * @returns {Record<string, unknown> | undefined}
 */
export function normalizeToolParametersSchema(parameters, toolName) {
    return tryZodToJsonSchema(parameters, toolName);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @typedef {import('@github/copilot-sdk/extension').JsonValue} JsonValue
 */

/**
 * Converte um valor desconhecido para o subconjunto JSON aceito pelo SDK. Valores não JSON são descartados; objetos
 * cíclicos e profundidade excessiva também são rejeitados para manter telemetry bounded e deterministicamente
 * serializável.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @param {number} [depth]
 * @returns {JsonValue | undefined}
 */
function normalizeJsonValue(value, seen = new WeakSet(), depth = 0) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (depth >= 32 || typeof value !== 'object') return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            /** @type {JsonValue[]} */
            const result = [];
            for (const item of value) {
                const normalized = normalizeJsonValue(item, seen, depth + 1);
                if (normalized !== undefined) result.push(normalized);
            }
            return result;
        }
        if (!isPlainRecord(value)) return undefined;
        /** @type {{ [key: string]: JsonValue }} */
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            const normalized = normalizeJsonValue(item, seen, depth + 1);
            if (normalized !== undefined) result[key] = normalized;
        }
        return result;
    } finally {
        seen.delete(value);
    }
}

/**
 * Normaliza `toolTelemetry` para o shape atual do SDK: `Record<string, Record<string, JsonValue> | undefined>`.
 *
 * @param {unknown} telemetry
 * @returns {import('@github/copilot-sdk').ToolTelemetry | undefined}
 */
export function normalizeToolTelemetry(telemetry) {
    if (!isPlainRecord(telemetry)) return undefined;
    /** @type {import('@github/copilot-sdk').ToolTelemetry} */
    const normalized = {};
    for (const [key, value] of Object.entries(telemetry)) {
        if (!key) continue;
        if (value === undefined) {
            normalized[key] = undefined;
            continue;
        }
        if (!isPlainRecord(value)) continue;
        const jsonValue = normalizeJsonValue(value);
        if (jsonValue && !Array.isArray(jsonValue) && typeof jsonValue === 'object') {
            normalized[key] = jsonValue;
        }
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * @param {unknown} result
 * @returns {result is import('@github/copilot-sdk').ToolResultObject}
 */
function isToolResultObject(result) {
    return (
        isPlainRecord(result) &&
        typeof result['textResultForLlm'] === 'string' &&
        typeof result['resultType'] === 'string'
    );
}

/**
 * @template TResult
 * @param {string} toolName
 * @param {TResult} result
 * @param {number} durationMs
 * @returns {TResult}
 */
function withSdkToolTelemetry(toolName, result, durationMs) {
    if (!isToolResultObject(result)) return result;
    const existing = normalizeToolTelemetry(result.toolTelemetry);
    const copilot = {
        ...(existing?.['copilot'] ?? {}),
        toolName,
        durationMs,
        resultType: result.resultType,
    };
    return /** @type {TResult} */ ({
        ...result,
        toolTelemetry: {
            ...(existing ?? {}),
            copilot,
        },
    });
}

/**
 * Cria a forma mínima de Tool quando o SDK externo está mockado de forma parcial em testes.
 *
 * @template T
 * @param {string} name
 * @param {{
 *     description: string;
 *     parameters?: Record<string, unknown>;
 *     handler?: import('@github/copilot-sdk').ToolHandler<T>;
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
 *     handler?: import('@github/copilot-sdk').ToolHandler<T>;
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
        const normalized = toError(err);
        if (/defineTool.*export|No "defineTool" export/i.test(normalized.message)) {
            return makePlainSdkTool(name, config);
        }
        throw normalized;
    }
}

/**
 * @template TArgs
 * @template TResult
 * @param {string} name
 * @param {import('@github/copilot-sdk').Tool<TArgs>} tool
 * @returns {ExecutableTool<TArgs, TResult>}
 */
function requireExecutableTool(name, tool) {
    if (typeof tool?.handler !== 'function') {
        throw new TypeError(`[sdk/tools] createTool: SDK returned '${name}' without an executable handler`);
    }
    return /** @type {ExecutableTool<TArgs, TResult>} */ (tool);
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
 * @template [TResult=unknown] Default is `unknown`
 * @param {CreateToolOptions<T, TResult>} options
 * @returns {ExecutableTool<T, TResult>}
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

    const jsonSchema = normalizeToolParametersSchema(/** @type {ToolParameterInput | undefined} */ (parameters), name);

    /** @type {(args: T, invocation?: import('@github/copilot-sdk').ToolInvocation) => Promise<TResult>} */
    const wrappedHandler = async (args, invocation) => {
        log('DEBUG', `[sdk/tools] Invocando '${name}' (session=${invocation?.sessionId ?? 'n/a'})`);
        const startedAt = Date.now();
        const result = await handler(args, invocation);
        return withSdkToolTelemetry(name, result, Date.now() - startedAt);
    };

    return requireExecutableTool(
        name,
        defineToolSafe(name, {
            description,
            ...(jsonSchema !== undefined ? { parameters: jsonSchema } : {}),
            handler: wrappedHandler,
            skipPermission,
            ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
        }),
    );
}

/**
 * Cria uma tool declaration-only do SDK 1.0. O runtime anuncia a ferramenta, mas a execução deve ser resolvida por
 * eventos/RPC de pending external tool; use `createTool()` para tools executáveis locais.
 *
 * @template [T=unknown] Default is `unknown`
 * @param {CreateDeclarationToolOptions<T>} options
 * @returns {import('@github/copilot-sdk').Tool<T>}
 */
export function createDeclarationTool({
    name,
    description,
    parameters,
    skipPermission = false,
    overridesBuiltInTool = false,
}) {
    if (!name || typeof name !== 'string') {
        throw new TypeError('[sdk/tools] createDeclarationTool: name (string) é obrigatório');
    }

    const jsonSchema = normalizeToolParametersSchema(/** @type {ToolParameterInput | undefined} */ (parameters), name);

    return defineToolSafe(name, {
        description,
        ...(jsonSchema !== undefined ? { parameters: jsonSchema } : {}),
        skipPermission,
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}

/**
 * Cria uma tool síncrona (sem async no handler) — variante de conveniência.
 *
 * @template [T=unknown] Default is `unknown`
 * @template [TResult=unknown] Default is `unknown`
 * @param {CreateToolOptions<T, TResult>} options
 * @returns {ExecutableTool<T, TResult>}
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

    /** @type {(args: T, invocation?: import('@github/copilot-sdk').ToolInvocation) => Promise<TResult>} */
    const wrappedHandler = async (args, invocation) => {
        log('DEBUG', `[sdk/tools] Invocando '${name}' (session=${invocation?.sessionId ?? 'n/a'})`);
        const startedAt = Date.now();
        const result = await handler(args, invocation);
        return withSdkToolTelemetry(name, result, Date.now() - startedAt);
    };

    const jsonSchema = normalizeToolParametersSchema(/** @type {ToolParameterInput | undefined} */ (parameters), name);

    return requireExecutableTool(
        name,
        defineToolSafe(name, {
            description,
            ...(jsonSchema !== undefined ? { parameters: jsonSchema } : {}),
            handler: wrappedHandler,
            skipPermission,
            ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
        }),
    );
}
