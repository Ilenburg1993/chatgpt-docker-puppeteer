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
 * @see module:copilot/agent/tools-bootstrap
 * @see module:copilot/lib/tools-registry
 */

import { BridgeError } from '#copilot/core/errors';
import { MCP_PORT as _MCP_PORT, MCP_PORT_PROBE_TIMEOUT_MS } from '#copilot/config/env';
import { log } from '#copilot/observability/logger';
import { defineTool } from '@github/copilot-sdk';
import net from 'node:net';
import { z } from 'zod';

/**
 * Estado de saúde do MCP bridge. Atualizado a cada chamada de `buildMcpTools()` e pelo health check periódico.
 *
 * @typedef {object} McpHealthStatus
 * @property {boolean} available - true se o último check foi bem-sucedido
 * @property {number | null} lastCheckMs - Timestamp (Date.now()) do último check, ou null se nunca executado
 * @property {string | null} lastError - Mensagem do último erro, ou null
 * @property {number} toolCount - Número de tools MCP disponíveis no último check bem-sucedido
 * @property {boolean} circuitOpen - true se o circuit breaker está aberto
 * @property {number | null} latencyMs - Latência da última chamada listMcpTools bem-sucedida (ms), ou null
 */

/** @type {McpHealthStatus} */
let _mcpHealth = {
    available: false,
    lastCheckMs: null,
    lastError: null,
    toolCount: 0,
    circuitOpen: false,
    latencyMs: null,
};

/**
 * Retorna uma snapshot imutável do estado de saúde do MCP bridge.
 *
 * @returns {McpHealthStatus}
 */
export function getMcpStatus() {
    return { ..._mcpHealth };
}

// FINDING-P4-2: usar MCP_PORT dedicado com fallback para PORT genérico e 3008
const MCP_PORT = _MCP_PORT;
const MCP_BASE = `http://127.0.0.1:${MCP_PORT}/api/mcp`;

/**
 * F10.1: probe TCP rápido para verificar se a porta MCP está aberta sem bloquear o boot.
 *
 * Evita ~24s de espera (3 × 8s timeout) quando o servidor MCP está offline. Tempo máximo: PORT_PROBE_TIMEOUT_MS.
 *
 * @returns {Promise<boolean>} true se a porta está acessível
 */
function _isMcpPortOpen() {
    const portProbeTimeoutMs = MCP_PORT_PROBE_TIMEOUT_MS;
    return new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port: Number(MCP_PORT) }, () => {
            socket.destroy();
            resolve(true);
        });
        socket.setTimeout(portProbeTimeoutMs);
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => resolve(false));
    });
}

// UPG-02: Circuit Breaker para chamadas ao MCP Tool Registry
// Evita 40s de bloqueio quando o servidor MCP está offline (5 tentativas × 8s timeout)
let _mcpCircuitOpen = false;
let _mcpCircuitOpenAt = 0;
const CIRCUIT_RESET_MS = 60_000;

// BUG-MED-09 (fix): backoff exponencial para tentativas iniciais após restart do processo
// Evita ~9 tentativas HTTP desnecessárias quando o servidor MCP está offline no boot
const _BOOT_BACKOFF_MS = [0, 200, 1000, 5_000]; // tentativas 1–4: imediata, 200ms, 1s, 5s
let _bootAttemptCount = 0;

/**
 * @typedef {object} McpToolMeta
 * @property {string} name - Nome canônico da tool
 * @property {string} description - Descrição legível
 * @property {object} inputSchema - JSON Schema dos parâmetros
 */

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
 * Executa uma requisição JSON-RPC 2.0 contra o endpoint MCP local.
 *
 * MELHORIA-11 (fix): adiciona retry com backoff exponencial para erros de rede transientes (ECONNRESET, ETIMEDOUT, HTTP
 * 5xx). Tenta até 3 vezes com jitter.
 *
 * @param {string} method - Método JSON-RPC (ex: 'tools/list', 'tools/call')
 * @param {unknown} [params] - Parâmetros do método
 * @returns {Promise<unknown>} Resultado do campo `result` ou lança Error em caso de falha
 * @throws {Error} Se o servidor MCP retornar erro HTTP, erro RPC ou conexão falhar após retries
 */
async function rpcCall(method, params) {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params: params ?? {},
    });

    const MAX_ATTEMPTS = 3;
    /** @type {unknown} */
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
                const err = new BridgeError(`MCP HTTP ${response.status}: ${response.statusText}`, 'MCP_HTTP_ERROR');
                // Só faz retry em erros 5xx (servidor); 4xx são definitivos
                if (response.status < 500) throw err;
                lastError = err;
                if (attempt < MAX_ATTEMPTS - 1) {
                    await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt) + Math.random() * 100));
                    continue;
                }
                throw err;
            }

            const json = /** @type {{ error?: unknown; result?: unknown }} */ (await response.json());

            if (json.error) {
                throw new BridgeError(`MCP RPC error [${method}]: ${JSON.stringify(json.error)}`, 'MCP_RPC_ERROR');
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
        /** @type {{ tools?: McpToolMeta[] }} */
        const result = /** @type {{ tools?: McpToolMeta[] }} */ (await rpcCall('tools/list', {}));
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
    /** @type {JsonSchemaFragment} */
    const schema = /** @type {JsonSchemaFragment} */ (inputSchema);

    if (!schema) return z.unknown();

    // FINDING-P4-1: allOf — merge de properties/required de todos os schemas
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
        if (schema.allOf.length === 1) {
            return buildZodSchema(/** @type {JsonSchemaFragment} */ (schema.allOf[0]), parentRequired, key);
        }
        // Merge recursivo: combinar properties e required de todos os schemas
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
        // GAP-SDK-07 (fix): MCP tools devem override built-ins com o mesmo nome
        overridesBuiltInTool: true,
        handler: async (/** @type {Record<string, unknown>} */ params) => {
            try {
                const result = await rpcCall('tools/call', {
                    name: mcpTool.name,
                    arguments: params,
                });

                if (typeof result === 'string') return result;

                // MCP retorna { content: [{ type: 'text', text: '...' }] } ou texto direto
                const obj = /** @type {{ content?: { type: string; text?: string }[] }} */ (result);
                const content = obj?.content;
                if (Array.isArray(content)) {
                    return content
                        .filter((/** @type {{ type: string; text?: string }} */ c) => c?.type === 'text')
                        .map((/** @type {{ type: string; text?: string }} */ c) => c.text)
                        .join('\n');
                }
                return JSON.stringify(result, null, 2);
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
    // UPG-02: circuit breaker — não tentar se o circuito está aberto
    if (_mcpCircuitOpen && Date.now() - _mcpCircuitOpenAt < CIRCUIT_RESET_MS) {
        log('INFO', '[mcp-tool-bridge] Circuit aberto — pulando consulta ao MCP Registry.');
        _mcpHealth = { ..._mcpHealth, circuitOpen: true };
        return [];
    }

    // F10.1: port probe rápido antes de qualquer HTTP — evita 24s de bloqueio quando servidor está offline
    const portOpen = await _isMcpPortOpen();
    if (!portOpen) {
        _mcpCircuitOpen = true;
        _mcpCircuitOpenAt = Date.now();
        _bootAttemptCount = 0;
        _mcpHealth = {
            available: false,
            lastCheckMs: Date.now(),
            lastError: `ECONNREFUSED (port probe: ${MCP_PORT} fechada)`,
            toolCount: 0,
            circuitOpen: true,
            latencyMs: null,
        };
        log('INFO', `[mcp-tool-bridge] Porta MCP ${MCP_PORT} fechada (standalone?) — circuit aberto imediatamente.`);
        return [];
    }

    // BUG-MED-09 (fix): aplicar backoff exponencial nas tentativas iniciais de boot
    const bootDelay = _BOOT_BACKOFF_MS[Math.min(_bootAttemptCount, _BOOT_BACKOFF_MS.length - 1)] ?? 0;
    _bootAttemptCount++;
    if (bootDelay > 0) {
        await new Promise((r) => setTimeout(r, bootDelay));
    }

    let mcpTools;
    try {
        const _t0mcp = Date.now();
        mcpTools = await listMcpTools();
        _mcpCircuitOpen = false; // reset em caso de sucesso
        _bootAttemptCount = 0; // BUG-MED-09: reset contador de boot após sucesso
        _mcpHealth = {
            available: true,
            lastCheckMs: Date.now(),
            lastError: null,
            toolCount: mcpTools.length,
            circuitOpen: false,
            latencyMs: Date.now() - _t0mcp,
        };
    } catch (/** @type {any} */ err) {
        _mcpCircuitOpen = true;
        _mcpCircuitOpenAt = Date.now();
        _bootAttemptCount = 0; // F3.2 (BUG-MOD-02): resetar ao abrir circuit para evitar backoff acumulado
        _mcpHealth = {
            available: false,
            lastCheckMs: Date.now(),
            lastError: err.message,
            toolCount: 0,
            circuitOpen: true,
            latencyMs: null,
        };
        log(
            'WARN',
            `[mcp-tool-bridge] Falha ao consultar MCP Registry — circuit aberto por ${CIRCUIT_RESET_MS / 1000}s: ${err.message}`,
        );
        return [];
    }

    if (mcpTools.length === 0) {
        log('INFO', '[mcp-tool-bridge] Nenhuma tool MCP disponível (servidor offline ou MCP_ENABLED=false).');
        return [];
    }

    log('INFO', `[mcp-tool-bridge] Construindo ${mcpTools.length} Custom Tools a partir do MCP Registry.`);

    return mcpTools.map((tool) => createSdkToolFromMcp(tool));
}

/**
 * Reseta estado interno mutable do bridge para isolamento de testes. **Não usar em produção.**
 *
 * @returns {void}
 * @internal
 */
export function _resetMcpState() {
    _mcpCircuitOpen = false;
    _mcpCircuitOpenAt = 0;
    _bootAttemptCount = 0;
    _mcpHealth = {
        available: false,
        lastCheckMs: null,
        lastError: null,
        toolCount: 0,
        circuitOpen: false,
        latencyMs: null,
    };
}

/**
 * F9.2: Inicia um job periódico de auto-reconnect ao MCP Tool Registry.
 *
 * Quando o circuit breaker está aberto ou não há tools disponíveis, o job tenta chamar `buildMcpTools()` e, em caso de
 * sucesso, invoca o callback `onReconnect` com a nova lista de tools para que o agente possa atualizar sua sessão.
 *
 * @param {(tools: import('@github/copilot-sdk').Tool[]) => void | Promise<void>} onReconnect - Callback chamado com as
 *   tools reconectadas quando o MCP volta a responder
 * @param {number} [baseIntervalMs=5 * 60_000] - Intervalo base em ms; multiplicado pelo backoff step (padrão: 5 min).
 *   Default is `5 * 60_000`
 * @returns {() => void} Função de cancelamento — chame para parar o job
 */
export function startMcpAutoReconnect(onReconnect, baseIntervalMs = 5 * 60_000) {
    // F10.2: backoff crescente para evitar ruído permanente em modo standalone
    // Passos: 1×, 2×, 3×, 6× — ex: 5min, 10min, 15min, 30min (cap)
    const BACKOFF_MULTIPLIERS = [1, 2, 3, 6];
    let _stepIndex = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let _timer = null;
    let _cancelled = false;

    function scheduleNext() {
        if (_cancelled) return;
        const mult = BACKOFF_MULTIPLIERS[Math.min(_stepIndex, BACKOFF_MULTIPLIERS.length - 1)] ?? 6;
        const delayMs = baseIntervalMs * mult;
        _timer = setTimeout(async () => {
            if (_cancelled) return;
            _timer = null;

            const status = getMcpStatus();
            if (!status.circuitOpen && status.available && status.toolCount > 0) {
                // MCP saudável — resetar backoff e reagendar no intervalo base
                _stepIndex = 0;
                scheduleNext();
                return;
            }

            log('DEBUG', `[mcp-auto-reconnect] Tentando reconectar (step ${_stepIndex}, delay ${delayMs / 1000}s)...`);
            try {
                const tools = await buildMcpTools();
                if (tools.length > 0) {
                    log('INFO', `[mcp-auto-reconnect] MCP reconectado: ${tools.length} tools disponíveis`);
                    _stepIndex = 0;
                    await onReconnect(tools);
                } else {
                    // Circuit fechou mas sem tools — avançar backoff
                    _stepIndex = Math.min(_stepIndex + 1, BACKOFF_MULTIPLIERS.length - 1);
                }
            } catch (/** @type {any} */ err) {
                const msg = err instanceof Error ? err.message : String(err);
                log('DEBUG', `[mcp-auto-reconnect] Falha na tentativa de reconnect: ${msg}`);
                _stepIndex = Math.min(_stepIndex + 1, BACKOFF_MULTIPLIERS.length - 1);
            }

            scheduleNext();
        }, delayMs);
        if (typeof _timer.unref === 'function') _timer.unref();
    }

    scheduleNext();

    return () => {
        _cancelled = true;
        if (_timer !== null) {
            clearTimeout(_timer);
            _timer = null;
        }
    };
}
