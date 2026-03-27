// @ts-check
/**
 * src/copilot/bridges/mcp-tool-bridge.js
 *
 * Ponte entre o MCP Tool Registry (exposto em /api/mcp) e o SDK de Custom Tools do Copilot.
 *
 * Responsabilidades:
 *
 * - Consultar o Tool Registry via HTTP para listar as tools disponíveis.
 * - Gerar dinamicamente Custom Tools SDK (`defineTool`) para cada tool MCP.
 * - Cada handler faz um POST /api/mcp com tools/call para executar a tool remotamente.
 *
 * Uso:
 *
 * ```js
 * const tools = await buildMcpTools();
 * // session.registerTools(tools)
 * ```
 *
 * @module copilot/bridges/mcp-tool-bridge
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';

/** Porta do servidor local (fallback: 3008). */
const MCP_PORT = process.env.PORT ?? '3008';
const MCP_BASE = `http://127.0.0.1:${MCP_PORT}/api/mcp`;

/**
 * @typedef {object} McpToolMeta
 * @property {string} name - Nome canônico da tool
 * @property {string} description - Descrição legível
 * @property {object} inputSchema - JSON Schema dos parâmetros
 */

/**
 * Executa uma requisição JSON-RPC 2.0 contra o endpoint MCP local.
 *
 * MELHORIA-11 (fix): adiciona retry com backoff exponencial para erros de rede transientes (ECONNRESET, ETIMEDOUT, HTTP
 * 5xx). Tenta até 3 vezes com jitter.
 *
 * @param {string} method - Método JSON-RPC (ex: 'tools/list', 'tools/call')
 * @param {unknown} [params] - Parâmetros do método
 * @returns {Promise<unknown>} Resultado do campo `result` ou lança Error em caso de falha
 */
async function rpcCall(method, params) {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params: params ?? {},
    });

    const MAX_ATTEMPTS = 3;
    /** @type {any} */
    let lastError;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(MCP_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(8000),
            });

            if (!response.ok) {
                const err = new Error(`MCP HTTP ${response.status}: ${response.statusText}`);
                // Só faz retry em erros 5xx (servidor); 4xx são definitivos
                if (response.status < 500) throw err;
                lastError = err;
                if (attempt < MAX_ATTEMPTS - 1) {
                    await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt) + Math.random() * 100));
                    continue;
                }
                throw err;
            }

            const json = /** @type {any} */ (await response.json());

            if (json.error) {
                throw new Error(`MCP RPC error [${method}]: ${JSON.stringify(json.error)}`);
            }

            return json.result;
        } catch (/** @type {any} */ e) {
            lastError = e;
            const isTransient = e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.name === 'TimeoutError';
            if (!isTransient || attempt >= MAX_ATTEMPTS - 1) throw e;
            log(
                'WARN',
                `[mcp-tool-bridge] rpcCall '${method}' falhou (tentativa ${attempt + 1}/${MAX_ATTEMPTS}): ${e.message}`,
            );
            await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt) + Math.random() * 100));
        }
    }
    throw lastError;
}

/**
 * Lista as tools disponíveis no MCP Tool Registry local.
 *
 * @returns {Promise<McpToolMeta[]>} Array de metadados de tools
 */
export async function listMcpTools() {
    try {
        /** @type {any} */
        const result = await rpcCall('tools/list', {});
        const tools = /** @type {McpToolMeta[]} */ (result?.tools ?? []);
        return tools.filter((t) => t && typeof t.name === 'string');
    } catch (/** @type {any} */ e) {
        log('WARN', `[mcp-tool-bridge] Falha ao listar tools MCP: ${e.message}`);
        return [];
    }
}

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
function buildZodSchema(inputSchema, parentRequired, key) {
    /** @type {any} */
    const schema = inputSchema;

    if (!schema) return z.unknown();

    // GAP-02: enum (string literal union)
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        if (schema.enum.every((/** @type {any} */ v) => typeof v === 'string')) {
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
            // GAP-02: recursão para objetos aninhados
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

/**
 * Cria um Custom Tool SDK que delega a execução para a tool MCP correspondente via HTTP.
 *
 * @param {McpToolMeta} mcpTool - Metadados da tool MCP
 * @returns {import('@github/copilot-sdk').Tool} Custom Tool pronta para uso no SDK
 */
function createSdkToolFromMcp(mcpTool) {
    const schema = buildZodSchema(mcpTool.inputSchema ?? {});
    const toolName = `mcp_${mcpTool.name}`;

    return defineTool(toolName, {
        description: `[MCP] ${mcpTool.description ?? mcpTool.name}`,
        parameters: schema,
        handler: async (/** @type {Record<string, unknown>} */ params) => {
            try {
                /** @type {any} */
                const result = await rpcCall('tools/call', {
                    name: mcpTool.name,
                    arguments: params,
                });

                // MCP retorna { content: [{ type: 'text', text: '...' }] } ou texto direto
                const content = result?.content;
                if (Array.isArray(content)) {
                    return content
                        .filter((/** @type {any} */ c) => c?.type === 'text')
                        .map((/** @type {any} */ c) => c.text)
                        .join('\n');
                }
                return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            } catch (/** @type {any} */ e) {
                log('WARN', `[mcp-tool-bridge] Falha ao executar tool '${mcpTool.name}': ${e.message}`);
                return `Erro ao executar ${mcpTool.name}: ${e.message}`;
            }
        },
    });
}

/**
 * Constrói Custom Tools SDK para todas as tools disponíveis no MCP Tool Registry local.
 *
 * Consulta dinamicamente o endpoint MCP para descobrir as tools disponíveis e gera uma Custom Tool SDK para cada uma,
 * prefixada com `mcp_`.
 *
 * @returns {Promise<import('@github/copilot-sdk').Tool[]>} Array de Custom Tools prontas para registro no SDK
 */
export async function buildMcpTools() {
    const mcpTools = await listMcpTools();

    if (mcpTools.length === 0) {
        log('INFO', '[mcp-tool-bridge] Nenhuma tool MCP disponível (servidor offline ou MCP_ENABLED=false).');
        return [];
    }

    log('INFO', `[mcp-tool-bridge] Construindo ${mcpTools.length} Custom Tools a partir do MCP Registry.`);

    return mcpTools.map((tool) => createSdkToolFromMcp(tool));
}
