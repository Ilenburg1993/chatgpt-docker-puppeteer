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
 * @see EventBus
 * @see module:copilot/agent/tools-bootstrap
 * @see module:copilot/lib/tools-registry
 */

import { MCP_PORT as _MCP_PORT, MCP_PORT_PROBE_TIMEOUT_MS } from '#copilot/config';
import { BridgeError, container, toError, withRetry } from '#copilot/core';
import { log, METRICS_STORE, startSpanImmediate } from '#copilot/observability';
import { createTool } from '#copilot/sdk';
import net from 'node:net';
import { buildZodSchema } from './mcp-tool-schema.js';

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

/** @typedef {import('./mcp-tool-schema.js').JsonSchemaFragment} JsonSchemaFragment */

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

    const span = startSpanImmediate('copilot.bridge.mcp', {
        bridge_type: 'mcp',
        method,
    });
    const t0 = Date.now();

    try {
        const result = await withRetry(
            async () => {
                const response = await fetch(MCP_BASE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: AbortSignal.timeout(8000),
                });

                if (!response.ok) {
                    const err = new BridgeError(
                        `MCP HTTP ${response.status}: ${response.statusText}`,
                        'MCP_HTTP_ERROR',
                    );
                    throw err;
                }

                const json = /** @type {{ error?: unknown; result?: unknown }} */ (await response.json());

                if (json.error) {
                    throw new BridgeError(`MCP RPC error [${method}]: ${JSON.stringify(json.error)}`, 'MCP_RPC_ERROR');
                }

                return json.result;
            },
            {
                maxAttempts: 3,
                baseDelayMs: 200,
                shouldRetry: (e) => {
                    const err = toError(e);
                    const isNetworkError =
                        err?.code === 'ECONNRESET' || err?.code === 'ECONNREFUSED' || err?.name === 'TimeoutError';
                    const isServerError =
                        e instanceof BridgeError && /** @type {BridgeError} */ (e).message.includes('HTTP 5');
                    return isNetworkError || isServerError;
                },
                onRetry: (e, attempt) => {
                    log(
                        'WARN',
                        `[mcp-tool-bridge] rpcCall '${method}' falhou (tentativa ${attempt}/3): ${toError(e)?.message}`,
                    );
                },
            },
        );

        span?.setAttribute('duration_ms', Date.now() - t0);
        span?.setAttribute('status_code', 0);
        span?.setStatus({ code: 1 });
        container.resolve(METRICS_STORE).recordToolCall(`bridge.mcp.${method}`, Date.now() - t0, true);
        return result;
    } catch (err) {
        span?.setAttribute('duration_ms', Date.now() - t0);
        span?.setAttribute('status_code', 2);
        span?.setStatus({ code: 2, message: toError(err).message });
        span?.recordException(err);
        container.resolve(METRICS_STORE).recordToolCall(`bridge.mcp.${method}`, Date.now() - t0, false);
        container.resolve(METRICS_STORE).recordCounter('copilot.bridge.errors_total');
        throw err;
    } finally {
        span?.end();
    }
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
    } catch (e) {
        log('WARN', `[mcp-tool-bridge] Falha ao listar tools MCP: ${toError(e).message}`);
        return [];
    }
}

/**
 * Cria um Custom Tool SDK que delega a execução para a tool MCP correspondente via HTTP.
 *
 * @param {McpToolMeta} mcpTool - Metadados da tool MCP
 * @returns {import('#copilot/sdk/types').Tool<Record<string, unknown>>} Custom Tool pronta para uso no SDK
 */
function createSdkToolFromMcp(mcpTool) {
    const schema = buildZodSchema(mcpTool.inputSchema ?? {});
    const toolName = `mcp_${mcpTool.name}`;

    return createTool({
        name: toolName,
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
            } catch (e) {
                log('WARN', `[mcp-tool-bridge] Falha ao executar tool '${mcpTool.name}': ${toError(e).message}`);
                return `Erro ao executar ${mcpTool.name}: ${toError(e).message}`;
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
 * @returns {Promise<import('#copilot/sdk/types').Tool<any>[]>} Array de Custom Tools prontas para registro no SDK
 */
export async function buildMcpTools() {
    // UPG-02: circuit breaker — não tentar se o circuito está aberto
    if (_mcpCircuitOpen && Date.now() - _mcpCircuitOpenAt < CIRCUIT_RESET_MS) {
        log('DEBUG', '[mcp-tool-bridge] Circuit aberto — pulando consulta ao MCP Registry.');
        _mcpHealth = { ..._mcpHealth, circuitOpen: true };
        return [];
    }

    // F10.1: port probe rápido antes de qualquer HTTP — evita 24s de bloqueio quando servidor está offline
    const portOpen = await _isMcpPortOpen();
    if (!portOpen) {
        const closedPortReason = `ECONNREFUSED (port probe: ${MCP_PORT} fechada)`;
        const repeatedStandalonePortClosed = _mcpHealth.lastError === closedPortReason && _mcpHealth.circuitOpen;
        _mcpCircuitOpen = true;
        _mcpCircuitOpenAt = Date.now();
        _bootAttemptCount = 0;
        _mcpHealth = {
            available: false,
            lastCheckMs: Date.now(),
            lastError: closedPortReason,
            toolCount: 0,
            circuitOpen: true,
            latencyMs: null,
        };
        log(
            repeatedStandalonePortClosed ? 'DEBUG' : 'INFO',
            `[mcp-tool-bridge] Porta MCP ${MCP_PORT} fechada (standalone?) — circuit aberto imediatamente.`,
        );
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
    } catch (err) {
        _mcpCircuitOpen = true;
        _mcpCircuitOpenAt = Date.now();
        _bootAttemptCount = 0; // F3.2 (BUG-MOD-02): resetar ao abrir circuit para evitar backoff acumulado
        _mcpHealth = {
            available: false,
            lastCheckMs: Date.now(),
            lastError: toError(err).message,
            toolCount: 0,
            circuitOpen: true,
            latencyMs: null,
        };
        log(
            'WARN',
            `[mcp-tool-bridge] Falha ao consultar MCP Registry — circuit aberto por ${CIRCUIT_RESET_MS / 1000}s: ${toError(err).message}`,
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
 * @param {(tools: import('#copilot/sdk/types').Tool[]) => void | Promise<void>} onReconnect - Callback chamado com as
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
            } catch (err) {
                const msg = err instanceof Error ? toError(err).message : String(err);
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
