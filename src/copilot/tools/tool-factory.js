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
 * @see module:copilot/lib/tools-registry
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

import { log } from './logger.js';
import { createTool } from '#copilot/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';

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
 * ou JSON Schema direto.
 *
 * @param {import('zod').ZodType | import('zod/v3').ZodTypeAny | Record<string, unknown> | undefined} parameters
 * @returns {Record<string, unknown> | undefined}
 */
function normalizeParameters(parameters) {
    if (!parameters) return undefined;

    // Detecta instância Zod v3 (`_def`) ou Zod v4 (`_zod`).
    // Zod v4 mudou a arquitetura interna — a propriedade identificadora passou de `_def` para `_zod`.
    // Ambas indicam um schema Zod que precisa ser convertido para JSON Schema antes de ser passado ao SDK.
    if ('_def' in parameters || '_zod' in parameters) {
        try {
            return /** @type {Record<string, unknown>} */ (
                zodToJsonSchema(/** @type {import('zod/v3').ZodTypeAny} */ (parameters))
            );
        } catch (err) {
            log('WARN', `[tool-factory] Falha ao converter Zod schema: ${/** @type {Error} */ (err).message}`);
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
    const jsonSchemaParams = normalizeParameters(parameters);

    const wrappedHandler = /** @type {import('#copilot/sdk/types').ToolHandler<TArgs>} */ (
        async (args, invocation) => {
            log('DEBUG', `[tool-factory] Invocando tool '${name}' (sessionId=${invocation?.sessionId ?? 'n/a'})`);
            return handler(args, invocation);
        }
    );

    return createTool({ name,
        description,
        ...(jsonSchemaParams !== undefined ? { parameters: jsonSchemaParams } : {}),
        handler: wrappedHandler,
        ...(requiresApproval ? { skipPermission: false } : {}),
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}

/**
 * Marca uma tool existente como `skipPermission: true` (execução sem aprovação prévia do usuário). Aplicável a tools de
 * leitura, introspecção e operações sem efeito colateral.
 *
 * @template [TArgs=unknown]
 * @param {import('#copilot/sdk/types').Tool<TArgs>} tool - Tool a ser marcada
 * @returns {import('#copilot/sdk/types').Tool<TArgs>} A mesma tool com `skipPermission: true`
 */
export const withSkipPermission = (tool) =>
    Object.assign(tool, /** @type {Record<string, unknown>} */ ({ skipPermission: true }));
