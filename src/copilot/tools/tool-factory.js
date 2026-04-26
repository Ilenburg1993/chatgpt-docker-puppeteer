// @ts-check
/**
 * src/copilot/tools/tool-factory.js
 *
 * AH.4 — Fábrica de Custom Tools para o Always-Alive Agent. Encapsula `defineTool` do SDK com convenções do projeto:
 *
 * - JSDoc/interfaces para parâmetros (sem Zod obrigatório)
 * - Suporte a Zod schemas via `zod-to-json-schema` quando disponível
 * - `skipPermission: false` por padrão (requer aprovação explícita para todas as tools)
 * - Logging automático via `#core/logger` em cada invocação
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
 * import { buildTool } from '#copilot/tools';
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
 * @module copilot/tools/tool-factory
 * @see EventBus
 * @see module:copilot/sdk/tools-registry
 * @see module:copilot/agent/tools-bootstrap
 *
 * ## Quando usar `buildTool` vs `defineTool`
 *
 * - **`buildTool`** (este módulo): para tools de produção. Adiciona logging automático de invocação,
 *   validação Zod transparente via `zod-to-json-schema`, e padroniza `skipPermission`. Use em todos os
 *   arquivos de tools em `src/copilot/tools/`.
 * - **`defineTool`** (do `@github/copilot-sdk`): uso interno/SDK apenas. Evite chamar diretamente em
 *   código de produção — use `buildTool` que já encapsula o `defineTool`.
 */

import { createTool as sdkCreateTool } from '#copilot/sdk';
import { createRequire } from 'node:module';

/**
 * @returns {typeof import('zod-to-json-schema').zodToJsonSchema | null}
 */
function loadZodToJsonSchema() {
    const fn = /**
     * @type {typeof loadZodToJsonSchema & {
     *     _converter?: typeof import('zod-to-json-schema').zodToJsonSchema | null;
     *     _attempted?: boolean;
     * }}
     */ (loadZodToJsonSchema);
    if (fn._converter || fn._attempted) return fn._converter ?? null;
    fn._attempted = true;
    try {
        const requireFromHere = createRequire(import.meta.url);
        const mod = requireFromHere('zod-to-json-schema');
        fn._converter = mod.zodToJsonSchema ?? mod.default ?? null;
    } catch {
        fn._converter = null;
    }
    return fn._converter ?? null;
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
 * Factory SDK-first com fallback apenas para ciclos de inicialização.
 *
 * @param {Parameters<typeof sdkCreateTool>[0]} options
 * @returns {ReturnType<typeof sdkCreateTool>}
 */
function createTool(options) {
    try {
        const tool = sdkCreateTool(options);
        if (tool && typeof tool === 'object') {
            return tool;
        }
        return /** @type {ReturnType<typeof sdkCreateTool>} */ (makePlainTool(options));
    } catch (err) {
        if (
            (err instanceof ReferenceError && /initialization|initializ/i.test(err.message)) ||
            (err instanceof Error && /defineTool.*export|No "defineTool" export/i.test(err.message))
        ) {
            return /** @type {ReturnType<typeof sdkCreateTool>} */ (makePlainTool(options));
        }
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
    const line = `[sdk] ${level}: ${message}`;
    if (level === 'ERROR') {
        console.error(line);
    } else if (level === 'WARN') {
        console.warn(line);
    } else if (level === 'INFO') {
        console.info(line);
    } else if (process.env['COPILOT_LOG_LEVEL'] === 'DEBUG') {
        console.debug(line);
    }
}

/**
 * Opções para `buildTool`.
 *
 * @template TArgs
 * @typedef {object} BuildToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case recomendado)
 * @property {string} description - Descrição legível para o modelo
 * @property {import('zod').ZodType | import('zod/v3').ZodTypeAny | Record<string, unknown>} [parameters] - Schema Zod
 *   (v3 ou v4) ou JSON Schema manual dos parâmetros
 * @property {import('#copilot/sdk/types').ToolHandler<TArgs>} handler - Callback executor da ferramenta
 * @property {boolean} [requiresApproval] - Se `true` (default), skipPermission=false
 * @property {boolean} [overridesBuiltInTool] - Se sobrescreve ferramenta nativa do SDK
 */

/**
 * Normaliza o schema de parâmetros para o formato aceito pelo SDK. Aceita instâncias Zod (convertidas automaticamente)
 * ou JSON Schema direto. Se falhar na conversão, loga aviso e retorna undefined (permitindo tool sem parâmetros).
 *
 * @param {import('zod').ZodType | import('zod/v3').ZodTypeAny | Record<string, unknown> | undefined} parameters
 * @param {string} [toolName='unknown'] Default is `'unknown'`
 * @returns {Record<string, unknown> | undefined}
 */
function normalizeParameters(parameters, toolName = 'unknown') {
    if (!parameters) return undefined;

    // Detecta instância Zod v3 (`_def`) ou Zod v4 (`_zod`).
    // Zod v4 mudou a arquitetura interna — a propriedade identificadora passou de `_def` para `_zod`.
    // Ambas indicam um schema Zod que precisa ser convertido para JSON Schema antes de ser passado ao SDK.
    // H1-FIX: Usar instanceof ZodType quando possível para melhor compatibilidade com versões futuras.
    if ('_def' in parameters || '_zod' in parameters) {
        try {
            const converter = loadZodToJsonSchema();
            if (!converter) {
                throw new Error('zod-to-json-schema indisponível');
            }
            const jsonSchema = /** @type {Record<string, unknown>} */ (
                converter(/** @type {import('zod/v3').ZodTypeAny} */ (parameters))
            );
            return jsonSchema;
        } catch (err) {
            const message = /** @type {Error} */ (err).message;
            logToolFactory(
                'WARN',
                `[tool-factory] Falha ao converter Zod schema para '${toolName}': ${message}. Tool será registrada sem parâmetros.`,
            );
            // H1-FIX: Não relançar exceção — permitir tool sem parâmetros (fallback gracioso)
            return undefined;
        }
    }

    return /** @type {Record<string, unknown>} */ (parameters);
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
    handler,
    requiresApproval = true,
    overridesBuiltInTool = false,
}) {
    const jsonSchemaParams = normalizeParameters(parameters, name);

    const wrappedHandler = /** @type {import('#copilot/sdk/types').ToolHandler<TArgs>} */ (
        async (args, invocation) => {
            logToolFactory(
                'DEBUG',
                `[tool-factory] Invocando tool '${name}' (sessionId=${invocation?.sessionId ?? 'n/a'})`,
            );
            return handler(args, invocation);
        }
    );

    return /** @type {import('#copilot/sdk/types').Tool<TArgs>} */ (
        createTool({
            name,
            description,
            ...(jsonSchemaParams !== undefined ? { parameters: jsonSchemaParams } : {}),
            handler: /** @type {Parameters<typeof sdkCreateTool>[0]['handler']} */ (wrappedHandler),
            // Semântica explícita: requiresApproval=true => skipPermission=false; false => skipPermission=true.
            skipPermission: !requiresApproval,
            ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
        })
    );
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
    return Object.assign(tool, /** @type {Record<string, unknown>} */ ({ skipPermission: true }));
}
