// @ts-check
/**
 * src/copilot/tools/infra/tool-factory.js
 *
 * AH.4 — Fábrica de Custom Tools para o Always-Alive Agent. Encapsula `defineTool` do SDK com convenções do projeto:
 *
 * - JSDoc/interfaces para parâmetros (sem Zod obrigatório)
 * - Suporte a schemas Zod/Zod-like e JSON Schema via adaptador canônico do SDK
 * - `skipPermission: false` por padrão (requer aprovação explícita para todas as tools)
 * - Normalização canônica de parâmetros via SDK (`normalizeToolParametersSchema`)
 * - Fallback local apenas para janela de bootstrap/TDZ em ciclos ESM
 *
 * ## AH.5 — Integração LSP / IDE
 *
 * Todas as tools criadas com `buildTool` são expostas ao motor LSP (Pylance/tsserver) via geração de JSON Schema inline
 * no `parameters`. O fluxo é:
 *
 * 1. **Zod schema** (recomendado): passa um `ZodTypeAny` como `parameters`. O `zodToJsonSchema` converte para um JSON
 *    Schema Draft 7, que o SDK usa para:
 *
 *    - Gerar a especificação `tool_description` enviada ao modelo
 *    - Validar argumentos recebidos antes de invocar o `handler`
 * 2. **JSON Schema manual**: passa um `Record<string, unknown>` diretamente. Útil quando a ferramenta aceita tipos
 *    dinâmicos ou não-Zod.
 * 3. **Sem parâmetros**: omite `parameters` — a tool aceita qualquer argumento (sem validação SDK).
 *
 * ### Exemplo com Zod
 *
 * ```js
 * import { z } from 'zod/v3';
 * import { buildTool } from '../infra/tool-factory.js';
 *
 * const readFileTool = buildTool({
 *     name: 'read_file',
 *     description: 'Lê o conteúdo de um arquivo',
 *     parameters: z.object({
 *         path: z.string().describe('Caminho absoluto do arquivo'),
 *         encoding: z.enum(['utf8', 'base64']).optional().describe('Encoding (padrão: utf8)'),
 *     }),
 *     handler: async ({ path, encoding = 'utf8' }) => readFileSync(path, encoding),
 * });
 * ```
 *
 * ### Exemplo com JSON Schema manual
 *
 * ```js
 * const dynamicTool = buildTool({
 *     name: 'run_query',
 *     description: 'Executa uma query genérica',
 *     parameters: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
 *     handler: async ({ sql }) => runSql(sql),
 * });
 * ```
 *
 * @module copilot/tools/infra/tool-factory
 * @see EventBus
 * @see module:copilot/sdk/tools-registry
 * @see module:copilot/agent/tools-bootstrap
 *
 * ## Quando usar `buildTool` vs `defineTool`
 *
 * - **`buildTool`** (este módulo): para tools de produção. Reutiliza a normalização canônica do SDK,
 *   aplica hardening local/fallback e padroniza `skipPermission`. Use em todos os
 *   arquivos internos de `src/copilot/tools/` via import local (`../infra/tool-factory.js`), evitando ciclo com o barrel raiz.
 * - **`defineTool`** (do `@github/copilot-sdk`): uso interno/SDK apenas. Evite chamar diretamente em
 *   código de produção — use `buildTool` que já encapsula o `defineTool`.
 */

import { toError } from '#copilot/core';
import { normalizeToolParametersSchema, createTool as sdkCreateTool } from '#copilot/sdk/tools';
import { log as toolsLog } from './logger.js';
import { withToolFailureFeedback } from './tool-feedback.js';

/**
 * Determina se o erro permite fallback para tool plain (ciclo/TDZ/export indisponível).
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isRecoverableToolFactoryError(err) {
    if (!(err instanceof Error)) return false;
    const e = /** @type {Error & { code?: string }} */ (err);
    if (
        e.code === 'ERR_MODULE_NOT_FOUND' ||
        e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
        e.code === 'ERR_UNKNOWN_EXPORT'
    ) {
        return true;
    }
    // Ciclos/TDZ em ESM podem lançar ReferenceError durante inicialização do barrel.
    if (e instanceof ReferenceError) {
        return true;
    }
    return false;
}

/**
 * Fallback estritamente local para a janela de TDZ do barrel em ciclos ESM/Vitest.
 *
 * @param {{
 *     name: string;
 *     description: string;
 *     parameters?: Record<string, unknown>;
 *     handler: import('#copilot/sdk/types').ToolHandler<any>;
 *     skipPermission?: boolean;
 *     overridesBuiltInTool?: boolean;
 * }} options
 * @returns {import('#copilot/sdk/types').Tool<any>}
 */
function makePlainTool(options) {
    return /** @type {import('#copilot/sdk/types').Tool<any>} */ ({
        name: options.name,
        description: options.description,
        ...(options.parameters !== undefined ? { parameters: options.parameters } : {}),
        handler: options.handler,
        skipPermission: options.skipPermission ?? false,
        ...(options.overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}

/**
 * Constrói opções seguras para fallback plain tool, materializando apenas campos opcionais definidos.
 *
 * @param {Parameters<typeof sdkCreateTool>[0]} options
 * @returns {{
 *     name: string;
 *     description: string;
 *     parameters?: Record<string, unknown>;
 *     handler: import('#copilot/sdk/types').ToolHandler<any>;
 *     skipPermission?: boolean;
 *     overridesBuiltInTool?: boolean;
 * }}
 */
function buildPlainToolOptions(options) {
    const normalizedParameters =
        options.parameters !== undefined ? normalizeParameters(options.parameters, options.name) : undefined;
    return {
        name: options.name,
        description: options.description,
        handler: /** @type {import('#copilot/sdk/types').ToolHandler<any>} */ (options.handler),
        ...(normalizedParameters !== undefined ? { parameters: normalizedParameters } : {}),
        ...(typeof options.skipPermission === 'boolean' ? { skipPermission: options.skipPermission } : {}),
        ...(options.overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    };
}

/**
 * Factory SDK-first com fallback apenas para ciclos de inicialização.
 *
 * @param {Parameters<typeof sdkCreateTool>[0]} options
 * @returns {ReturnType<typeof sdkCreateTool>}
 */
function createTool(options) {
    const plainToolOptions = buildPlainToolOptions(options);
    const plainTool = makePlainTool(plainToolOptions);
    try {
        const tool = safeSdkCreateTool(options) || plainTool;
        return validateBuiltTool(options.name, tool);
    } catch (err) {
        if (isRecoverableToolFactoryError(err)) {
            logToolFactory(
                'WARN',
                `Fallback plain-tool ativado para '${options.name}' após erro recuperável: ${toError(err).message}`,
            );
            return validateBuiltTool(options.name, plainTool);
        }
        throw err;
    }
}

/**
 * Invoca o builder do SDK de forma resiliente a mocks parciais/exports ausentes.
 *
 * @param {Parameters<typeof sdkCreateTool>[0]} options
 * @returns {ReturnType<typeof sdkCreateTool> | null}
 */
function safeSdkCreateTool(options) {
    try {
        if (typeof sdkCreateTool !== 'function') return null;
        return sdkCreateTool(options);
    } catch (err) {
        if (isRecoverableToolFactoryError(err)) return null;
        throw err;
    }
}

/**
 * Logger local mínimo para manter a factory livre de ciclos com `tools/index`.
 *
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} message
 */
function logToolFactory(level, message) {
    try {
        if (typeof toolsLog === 'function') {
            toolsLog(level, `[tool-factory] ${String(message)}`);
        }
    } catch (error) {
        if (!isRecoverableToolFactoryError(error)) {
            throw error;
        }
    }
}

/**
 * Opções para `buildTool`.
 *
 * @template TArgs
 * @typedef {object} BuildToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case recomendado)
 * @property {string} description - Descrição legível para o modelo
 * @property {import('#copilot/sdk/types').ToolParameterInput<any>} [parameters]
 *
 *   - Schema Zod (v3 ou v4, inclusive tipagem SDK) ou JSON Schema manual dos parâmetros
 *
 * @property {string} [instructions] - Orientação operacional explícita para o modelo usar a tool com segurança.
 * @property {import('#copilot/sdk/types').ToolHandler<TArgs>} handler - Callback executor da ferramenta
 * @property {boolean} [requiresApproval] - Se `true` (default), skipPermission=false
 * @property {boolean} [overridesBuiltInTool] - Se sobrescreve ferramenta nativa do SDK
 * @property {'warn' | 'throw'} [schemaFailurePolicy] - `throw` impede registro sem schema após falha de normalização.
 * @property {Record<string, unknown>} [outputSchema] - Contrato local estruturado do resultado.
 * @property {Record<string, unknown>} [annotations] - Annotations locais no estilo MCP.
 */

/**
 * Normaliza o schema de parâmetros para o formato aceito pelo SDK. Aceita instâncias Zod (convertidas automaticamente)
 * ou JSON Schema direto.
 *
 * @param {import('#copilot/sdk/types').ToolParameterInput<any> | undefined} parameters
 * @param {string} [toolName='unknown'] Default is `'unknown'`
 * @param {'warn' | 'throw'} [failurePolicy='warn'] Default is `'warn'`
 * @returns {Record<string, unknown> | undefined}
 */
function normalizeParameters(parameters, toolName = 'unknown', failurePolicy = 'warn') {
    try {
        if (parameters === undefined) {
            return undefined;
        }
        if (typeof normalizeToolParametersSchema !== 'function') {
            if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
                return /** @type {Record<string, unknown>} */ (parameters);
            }
            throw new TypeError('normalizeToolParametersSchema is not a function');
        }
        return normalizeToolParametersSchema(
            /** @type {import('#copilot/sdk/types').ToolParameterInput<any> | undefined} */ (parameters),
            toolName,
        );
    } catch (err) {
        const message = toError(err).message;
        if (failurePolicy === 'throw') {
            throw new TypeError(`[tool-factory] Falha ao normalizar parâmetros de '${toolName}': ${message}`, {
                cause: err,
            });
        }
        logToolFactory(
            'WARN',
            `Falha ao normalizar parâmetros de '${toolName}': ${message}. Tool será registrada sem parâmetros.`,
        );
        return undefined;
    }
}

/**
 * Hardening local: garante que a tool produzida respeita o contrato canônico antes de sair da factory.
 *
 * @template T
 * @param {string} toolName
 * @param {import('#copilot/sdk/types').Tool<T>} tool
 * @returns {import('#copilot/sdk/types').Tool<T>}
 */
function validateBuiltTool(toolName, tool) {
    const validation = validateToolDefinitionContractLocal(tool);
    if (!validation.ok) {
        throw new TypeError(`[tool-factory] Tool '${toolName}' inválida: ${validation.reason}`);
    }
    return tool;
}

/**
 * Contrato mínimo local para evitar ciclos/TDZ com facades de validação mais altas.
 *
 * @param {unknown} tool
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
function validateToolDefinitionContractLocal(tool) {
    if (!tool || typeof tool !== 'object') {
        return { ok: false, reason: 'tool (object) obrigatório.' };
    }
    const candidate = /** @type {Record<string, unknown>} */ (tool);
    if (typeof candidate['name'] !== 'string' || candidate['name'].trim() === '') {
        return { ok: false, reason: 'name (string) obrigatório.' };
    }
    if (typeof candidate['description'] !== 'string' || candidate['description'].trim() === '') {
        return { ok: false, reason: 'description (string) obrigatório.' };
    }
    if (typeof candidate['handler'] !== 'function') {
        return { ok: false, reason: 'handler (function) obrigatório.' };
    }
    if (
        candidate['parameters'] !== undefined &&
        (typeof candidate['parameters'] !== 'object' ||
            candidate['parameters'] === null ||
            Array.isArray(candidate['parameters']))
    ) {
        return { ok: false, reason: 'parameters deve ser object quando definido.' };
    }
    if (candidate['instructions'] !== undefined && typeof candidate['instructions'] !== 'string') {
        return { ok: false, reason: 'instructions deve ser string quando definido.' };
    }
    return { ok: true };
}

/**
 * Cria e registra uma Custom Tool com as convenções do projeto.
 *
 * @example
 *     const myTool = buildTool({
 *         name: 'my_tool',
 *         description: 'Faz algo útil',
 *         parameters: z.object({ path: z.string().describe('Caminho do arquivo') }),
 *         handler: async ({ path }) => `Conteúdo de ${path}`,
 *     });
 *
 * @template TArgs
 * @param {BuildToolOptions<TArgs>} options
 * @returns {import('#copilot/sdk/types').Tool<TArgs>}
 */
export function buildTool({
    name,
    description,
    parameters,
    instructions,
    handler,
    requiresApproval = true,
    overridesBuiltInTool = false,
    schemaFailurePolicy = 'warn',
    outputSchema,
    annotations,
}) {
    const jsonSchemaParams = normalizeParameters(parameters, name, schemaFailurePolicy);
    const normalizedOutputSchema =
        outputSchema !== undefined ? normalizeParameters(outputSchema, `${name}:output`, 'throw') : undefined;
    const failureAwareHandler = withToolFailureFeedback(name, handler, {
        parameters: jsonSchemaParams,
    });

    const tool = createTool({
        name,
        description,
        ...(jsonSchemaParams !== undefined ? { parameters: jsonSchemaParams } : {}),
        handler: /** @type {Parameters<typeof sdkCreateTool>[0]['handler']} */ (failureAwareHandler),
        // Semântica explícita: requiresApproval=true => skipPermission=false; false => skipPermission=true.
        skipPermission: !requiresApproval,
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
    return /** @type {import('#copilot/sdk/types').Tool<TArgs>} */ ({
        ...tool,
        ...(typeof instructions === 'string' && instructions.trim().length > 0
            ? { instructions: instructions.trim() }
            : {}),
        ...(normalizedOutputSchema !== undefined ? { outputSchema: normalizedOutputSchema } : {}),
        ...(annotations && typeof annotations === 'object' && !Array.isArray(annotations)
            ? { annotations: { ...annotations } }
            : {}),
    });
}

/**
 * Marca uma tool existente como `skipPermission: true` (execução sem aprovação prévia do usuário). Aplicável a tools de
 * leitura, introspecção e operações sem efeito colateral.
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @param {import('#copilot/sdk/types').Tool<TArgs>} tool - Tool a ser marcada
 * @returns {import('#copilot/sdk/types').Tool<TArgs>} A mesma tool com `skipPermission: true`
 */
export function withSkipPermission(tool) {
    // FIX TF-01: Object.assign mutava o objeto original — todos os importadores passavam a ter skipPermission=true.
    // Solução: spread cria cópia rasa sem afetar a referência original.
    return /** @type {import('#copilot/sdk/types').Tool<TArgs>} */ ({ ...tool, skipPermission: true });
}
