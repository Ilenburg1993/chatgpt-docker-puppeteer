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
 * import { buildTool } from '#copilot/tools/tool-factory';
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
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Opções para `buildTool`.
 *
 * @template TArgs
 * @typedef {object} BuildToolOptions
 * @property {string} name - Nome único da ferramenta (snake_case recomendado)
 * @property {string} description - Descrição legível para o modelo
 * @property {import('zod/v3').ZodTypeAny | Record<string, unknown>} [parameters] - Schema Zod ou JSON Schema manual dos
 *   parâmetros
 * @property {import('@github/copilot-sdk').ToolHandler<TArgs>} handler - Callback executor da ferramenta
 * @property {boolean} [requiresApproval] - Se `true` (default), skipPermission=false
 * @property {boolean} [overridesBuiltInTool] - Se sobrescreve ferramenta nativa do SDK
 */

/**
 * Normaliza o schema de parâmetros para o formato aceito pelo SDK. Aceita instâncias Zod (convertidas automaticamente)
 * ou JSON Schema direto.
 *
 * @param {import('zod/v3').ZodTypeAny | Record<string, unknown> | undefined} parameters
 * @returns {Record<string, unknown> | undefined}
 */
function normalizeParameters(parameters) {
    if (!parameters) return undefined;

    // Detecta instância Zod pela presença de `_def` (marcador interno do Zod)
    if ('_def' in parameters) {
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
 * @returns {import('@github/copilot-sdk').Tool<TArgs>}
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

    const wrappedHandler = /** @type {import('@github/copilot-sdk').ToolHandler<TArgs>} */ (
        async (args, invocation) => {
            log('DEBUG', `[tool-factory] Invocando tool '${name}' (sessionId=${invocation?.sessionId ?? 'n/a'})`);
            return handler(args, invocation);
        }
    );

    return defineTool(name, {
        description,
        ...(jsonSchemaParams !== undefined ? { parameters: jsonSchemaParams } : {}),
        handler: wrappedHandler,
        ...(requiresApproval ? { skipPermission: false } : {}),
        ...(overridesBuiltInTool ? { overridesBuiltInTool: true } : {}),
    });
}
