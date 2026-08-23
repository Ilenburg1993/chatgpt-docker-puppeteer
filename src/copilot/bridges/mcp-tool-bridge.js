// @ts-check
/**
 * src/copilot/bridges/mcp-tool-bridge.js
 *
 * Ponte entre o MCP Tool Registry (exposto em /api/mcp) e o SDK de Custom Tools do Copilot.
 *
 * Responsabilidades:
 *
 * - Consultar o Tool Registry via HTTP para listar as tools disponíveis.
 * - Gerar dinamicamente Custom Tools SDK para cada tool MCP via factory canônica.
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
 * @see module:copilot/sdk/tools-registry
 */

import { MCP_PORT as _MCP_PORT, MCP_PORT_PROBE_TIMEOUT_MS } from '#copilot/config';
import { withRetry } from '#copilot/infra/public/concurrency/resilience';
import { toError } from '#copilot/infra/public/platform/error';
import { readBoundedResponseJson } from '#copilot/infra/public/platform/http-response';
import * as observability from '#copilot/observability';
import { convertMcpCallToolResult } from '#copilot/sdk/tools';
import { buildTool } from '#copilot/tools';
import net from 'node:net';
import { BridgeError } from './errors.js';
import { buildZodSchema } from './mcp-tool-schema.js';

const CIRCUIT_RESET_MS = 60_000;
const BOOT_BACKOFF_MS = [0, 200, 1000, 5_000];
const MCP_BRIDGE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {object} BridgeMetricsStore
 * @property {(name: string, durationMs: number, success?: boolean) => void} recordToolCall
 * @property {(name: string, value?: number) => void} recordCounter
 */

/**
 * @typedef {object} McpBridgeState
 * @property {McpHealthStatus} health
 * @property {boolean} circuitOpen
 * @property {number} circuitOpenAt
 * @property {number} bootAttemptCount
 */

/**
 * @typedef {object} McpBridgeDeps
 * @property {string} mcpPort
 * @property {number} portProbeTimeoutMs
 * @property {string} baseUrl
 * @property {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string) => void} logFn
 * @property {(
 *     name: string,
 *     attrs?: Record<string, string | number>,
 * ) => import('#copilot/observability/otel').OtelSpan | null} startSpanImmediateFn
 * @property {BridgeMetricsStore} metricsStore
 * @property {(fn: () => Promise<unknown>, opts: Record<string, unknown>) => Promise<unknown>} withRetryFn
 * @property {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} fetchImpl
 * @property {typeof net.connect} connectFn
 * @property {() => number} now
 * @property {(ms: number) => Promise<void>} delayFn
 * @property {(inputSchema: object) => import('zod').ZodType<any>} schemaBuilder
 * @property {typeof buildTool} buildToolFn
 * @property {typeof convertMcpCallToolResult} convertMcpCallToolResultFn
 * @property {(() => Promise<boolean>) | undefined} [isPortOpenFn]
 */

function createInitialMcpHealth() {
    return {
        available: false,
        lastCheckMs: null,
        lastError: null,
        toolCount: 0,
        circuitOpen: false,
        latencyMs: null,
    };
}

/** @returns {McpBridgeState} */
function createMcpBridgeState() {
    return {
        health: createInitialMcpHealth(),
        circuitOpen: false,
        circuitOpenAt: 0,
        bootAttemptCount: 0,
    };
}

/**
 * @param {McpBridgeState} state
 * @returns {void}
 */
function resetMcpBridgeState(state) {
    state.circuitOpen = false;
    state.circuitOpenAt = 0;
    state.bootAttemptCount = 0;
    state.health = createInitialMcpHealth();
}

/**
 * @param {McpBridgeState} state
 * @returns {McpHealthStatus}
 */
function getMcpStatusFromState(state) {
    return { ...state.health };
}

function resolveBridgeMetricsStore() {
    return /** @type {BridgeMetricsStore} */ (observability.defaultMetrics);
}

/**
 * @param {string} mcpPort
 * @returns {string}
 */
function resolveMcpBaseUrl(mcpPort) {
    return `http://127.0.0.1:${mcpPort}/api/mcp`;
}

/**
 * @param {Partial<McpBridgeDeps>} [overrides]
 * @returns {McpBridgeDeps}
 */
function resolveMcpBridgeDeps(overrides = {}) {
    const mcpPort = overrides.mcpPort ?? _MCP_PORT;
    return {
        mcpPort,
        portProbeTimeoutMs: overrides.portProbeTimeoutMs ?? MCP_PORT_PROBE_TIMEOUT_MS,
        baseUrl: overrides.baseUrl ?? resolveMcpBaseUrl(mcpPort),
        logFn: overrides.logFn ?? observability.log ?? (() => {}),
        startSpanImmediateFn:
            overrides.startSpanImmediateFn ??
            /** @type {McpBridgeDeps['startSpanImmediateFn']} */ (
                typeof observability.startSpanImmediate === 'function' ? observability.startSpanImmediate : () => null
            ),
        metricsStore: overrides.metricsStore ?? resolveBridgeMetricsStore(),
        withRetryFn: overrides.withRetryFn ?? /** @type {McpBridgeDeps['withRetryFn']} */ (withRetry),
        fetchImpl: overrides.fetchImpl ?? fetch,
        connectFn: overrides.connectFn ?? net.connect,
        now: overrides.now ?? (() => Date.now()),
        delayFn: overrides.delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        schemaBuilder: overrides.schemaBuilder ?? buildZodSchema,
        buildToolFn: overrides.buildToolFn ?? buildTool,
        convertMcpCallToolResultFn: overrides.convertMcpCallToolResultFn ?? convertMcpCallToolResult,
        ...(typeof overrides.isPortOpenFn === 'function' ? { isPortOpenFn: overrides.isPortOpenFn } : {}),
    };
}

const _defaultMcpBridgeState = createMcpBridgeState();

/** @type {McpBridgeDeps | null} */
let _defaultMcpBridgeDeps = null;

/**
 * @returns {McpBridgeDeps}
 */
function getDefaultMcpBridgeDeps() {
    if (_defaultMcpBridgeDeps === null) {
        _defaultMcpBridgeDeps = resolveMcpBridgeDeps();
    }
    return _defaultMcpBridgeDeps;
}

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

/**
 * F10.1: probe TCP rápido para verificar se a porta MCP está aberta sem bloquear o boot.
 *
 * Evita ~24s de espera (3 × 8s timeout) quando o servidor MCP está offline. Tempo máximo: PORT_PROBE_TIMEOUT_MS.
 *
 * @returns {Promise<boolean>} true se a porta está acessível
 */
/**
 * @param {McpBridgeDeps} deps
 * @returns {Promise<boolean>}
 */
function _isMcpPortOpen(deps) {
    if (typeof deps.isPortOpenFn === 'function') {
        return deps.isPortOpenFn();
    }
    const portProbeTimeoutMs = deps.portProbeTimeoutMs;
    return new Promise((resolve) => {
        const socket = deps.connectFn({ host: '127.0.0.1', port: Number(deps.mcpPort) }, () => {
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

/**
 * @param {unknown} value
 * @returns {value is { content: unknown[]; isError?: boolean }}
 */
function isMcpCallToolResult(value) {
    return !!value && typeof value === 'object' && Array.isArray(/** @type {{ content?: unknown }} */ (value).content);
}

/**
 * @param {unknown} result
 * @param {McpBridgeDeps} deps
 * @returns {import('#copilot/sdk/types').ToolResult}
 */
function normalizeMcpToolResultForSdk(result, deps) {
    if (typeof result === 'string') return result;
    if (isMcpCallToolResult(result)) {
        return deps.convertMcpCallToolResultFn(/** @type {Parameters<typeof convertMcpCallToolResult>[0]} */ (result));
    }
    return {
        textResultForLlm: JSON.stringify(result, null, 2),
        resultType: 'success',
    };
}

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
 * @param {McpBridgeDeps} deps
 * @param {unknown} [params] - Parâmetros do método
 * @returns {Promise<unknown>} Resultado do campo `result` ou lança Error em caso de falha
 * @throws {Error} Se o servidor MCP retornar erro HTTP, erro RPC ou conexão falhar após retries
 */
async function rpcCall(method, deps, params) {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: deps.now(),
        method,
        params: params ?? {},
    });

    const span = deps.startSpanImmediateFn('copilot.bridge.mcp', {
        bridge_type: 'mcp',
        method,
    });
    const t0 = deps.now();

    try {
        const result = await deps.withRetryFn(
            async () => {
                const response = await deps.fetchImpl(deps.baseUrl, {
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

                const json = /** @type {{ error?: unknown; result?: unknown }} */ (
                    await readBoundedResponseJson(response, {
                        maxBytes: MCP_BRIDGE_MAX_RESPONSE_BYTES,
                        label: `MCP RPC ${method}`,
                    })
                );

                if (json.error) {
                    throw new BridgeError(`MCP RPC error [${method}]: ${JSON.stringify(json.error)}`, 'MCP_RPC_ERROR');
                }

                return json.result;
            },
            {
                maxAttempts: 3,
                baseDelayMs: 200,
                shouldRetry: (/** @type {unknown} */ e) => {
                    const err = toError(e);
                    const isNetworkError =
                        err?.code === 'ECONNRESET' || err?.code === 'ECONNREFUSED' || err?.name === 'TimeoutError';
                    const isServerError =
                        e instanceof BridgeError && /** @type {BridgeError} */ (e).message.includes('HTTP 5');
                    return isNetworkError || isServerError;
                },
                onRetry: (/** @type {unknown} */ e, /** @type {number} */ attempt) => {
                    deps.logFn(
                        'WARN',
                        `[mcp-tool-bridge] rpcCall '${method}' falhou (tentativa ${attempt}/3): ${toError(e)?.message}`,
                    );
                },
            },
        );

        span?.setAttribute('duration_ms', deps.now() - t0);
        span?.setAttribute('status_code', 0);
        span?.setStatus({ code: 1 });
        deps.metricsStore.recordToolCall(`bridge.mcp.${method}`, deps.now() - t0, true);
        return result;
    } catch (err) {
        span?.setAttribute('duration_ms', deps.now() - t0);
        span?.setAttribute('status_code', 2);
        span?.setStatus({ code: 2, message: toError(err).message });
        span?.recordException(observability.toOtelException(err));
        deps.metricsStore.recordToolCall(`bridge.mcp.${method}`, deps.now() - t0, false);
        deps.metricsStore.recordCounter('copilot.bridge.errors_total');
        throw err;
    } finally {
        span?.end();
    }
}

/**
 * Lista as tools disponíveis no MCP Tool Registry local.
 *
 * @param {McpBridgeDeps} deps
 * @param {{ swallowErrors?: boolean }} [options]
 * @returns {Promise<McpToolMeta[]>} Array de metadados de tools
 */
async function listMcpToolsInternal(deps, options = {}) {
    try {
        const result = /** @type {{ tools?: McpToolMeta[] }} */ (await rpcCall('tools/list', deps, {}));
        const tools = /** @type {McpToolMeta[]} */ (result?.tools ?? []);
        return tools.filter((t) => t && typeof t.name === 'string');
    } catch (e) {
        deps.logFn('WARN', `[mcp-tool-bridge] Falha ao listar tools MCP: ${toError(e).message}`);
        if (options.swallowErrors !== false) {
            return [];
        }
        throw e;
    }
}

/**
 * Lista as tools disponíveis no MCP Tool Registry local.
 *
 * @returns {Promise<McpToolMeta[]>} Array de metadados de tools
 */
export async function listMcpTools() {
    return listMcpToolsInternal(getDefaultMcpBridgeDeps(), { swallowErrors: true });
}

/**
 * Cria um Custom Tool SDK que delega a execução para a tool MCP correspondente via HTTP.
 *
 * @param {McpToolMeta} mcpTool - Metadados da tool MCP
 * @param {McpBridgeDeps} deps
 * @returns {import('#copilot/sdk/types').Tool<Record<string, unknown>>} Custom Tool pronta para uso no SDK
 */
function createSdkToolFromMcp(mcpTool, deps) {
    const schema = deps.schemaBuilder(mcpTool.inputSchema ?? {});
    const toolName = `mcp_${mcpTool.name}`;

    return deps.buildToolFn({
        name: toolName,
        description: `[MCP] ${mcpTool.description ?? mcpTool.name}`,
        parameters: schema,
        // CLI built-ins devem prevalecer em colisões de nome. MCP tools são prefixadas com `mcp_` e não devem
        // sobrescrever built-ins.
        handler: async (/** @type {Record<string, unknown>} */ params) => {
            try {
                const result = await rpcCall('tools/call', deps, {
                    name: mcpTool.name,
                    arguments: params,
                });

                return normalizeMcpToolResultForSdk(result, deps);
            } catch (e) {
                deps.logFn('WARN', `[mcp-tool-bridge] Falha ao executar tool '${mcpTool.name}': ${toError(e).message}`);
                return {
                    textResultForLlm: `Erro ao executar ${mcpTool.name}: ${toError(e).message}`,
                    resultType: 'failure',
                    error: toError(e).message,
                };
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
 * @param {McpBridgeState} state
 * @param {McpBridgeDeps} deps
 * @returns {Promise<import('#copilot/sdk/types').Tool<any>[]>} Array de Custom Tools prontas para registro no SDK
 */
async function buildMcpToolsInternal(state, deps) {
    // UPG-02: circuit breaker — não tentar se o circuito está aberto
    if (state.circuitOpen && deps.now() - state.circuitOpenAt < CIRCUIT_RESET_MS) {
        deps.logFn('DEBUG', '[mcp-tool-bridge] Circuit aberto — pulando consulta ao MCP Registry.');
        state.health = { ...state.health, circuitOpen: true };
        return [];
    }

    // F10.1: port probe rápido antes de qualquer HTTP — evita 24s de bloqueio quando servidor está offline
    const portOpen = await _isMcpPortOpen(deps);
    if (!portOpen) {
        const closedPortReason = `ECONNREFUSED (port probe: ${deps.mcpPort} fechada)`;
        const repeatedStandalonePortClosed = state.health.lastError === closedPortReason && state.health.circuitOpen;
        state.circuitOpen = true;
        state.circuitOpenAt = deps.now();
        state.bootAttemptCount = 0;
        state.health = {
            available: false,
            lastCheckMs: deps.now(),
            lastError: closedPortReason,
            toolCount: 0,
            circuitOpen: true,
            latencyMs: null,
        };
        deps.logFn(
            repeatedStandalonePortClosed ? 'DEBUG' : 'INFO',
            `[mcp-tool-bridge] Porta MCP ${deps.mcpPort} fechada (standalone?) — circuit aberto imediatamente.`,
        );
        return [];
    }

    // BUG-MED-09 (fix): aplicar backoff exponencial nas tentativas iniciais de boot
    const bootDelay = BOOT_BACKOFF_MS[Math.min(state.bootAttemptCount, BOOT_BACKOFF_MS.length - 1)] ?? 0;
    state.bootAttemptCount++;
    if (bootDelay > 0) {
        await deps.delayFn(bootDelay);
    }

    let mcpTools;
    try {
        const _t0mcp = deps.now();
        mcpTools = await listMcpToolsInternal(deps, { swallowErrors: false });
        state.circuitOpen = false; // reset em caso de sucesso
        state.circuitOpenAt = 0;
        state.bootAttemptCount = 0; // BUG-MED-09: reset contador de boot após sucesso
        state.health = {
            available: true,
            lastCheckMs: deps.now(),
            lastError: null,
            toolCount: mcpTools.length,
            circuitOpen: false,
            latencyMs: deps.now() - _t0mcp,
        };
    } catch (err) {
        state.circuitOpen = true;
        state.circuitOpenAt = deps.now();
        state.bootAttemptCount = 0; // F3.2 (BUG-MOD-02): resetar ao abrir circuit para evitar backoff acumulado
        state.health = {
            available: false,
            lastCheckMs: deps.now(),
            lastError: toError(err).message,
            toolCount: 0,
            circuitOpen: true,
            latencyMs: null,
        };
        deps.logFn(
            'WARN',
            `[mcp-tool-bridge] Falha ao consultar MCP Registry — circuit aberto por ${CIRCUIT_RESET_MS / 1000}s: ${toError(err).message}`,
        );
        return [];
    }

    if (mcpTools.length === 0) {
        deps.logFn('INFO', '[mcp-tool-bridge] Nenhuma tool MCP disponível (servidor offline ou MCP_ENABLED=false).');
        return [];
    }

    deps.logFn('INFO', `[mcp-tool-bridge] Construindo ${mcpTools.length} Custom Tools a partir do MCP Registry.`);

    return mcpTools.map((tool) => createSdkToolFromMcp(tool, deps));
}

/**
 * Constrói Custom Tools SDK para todas as tools disponíveis no MCP Tool Registry local.
 *
 * @returns {Promise<import('#copilot/sdk/types').Tool<any>[]>}
 */
export async function buildMcpTools() {
    return buildMcpToolsInternal(_defaultMcpBridgeState, getDefaultMcpBridgeDeps());
}

/**
 * Retorna uma snapshot imutável do estado de saúde do MCP bridge default.
 *
 * @returns {McpHealthStatus}
 */
export function getMcpStatus() {
    return getMcpStatusFromState(_defaultMcpBridgeState);
}

/**
 * Reseta estado interno mutable do bridge para isolamento de testes. **Não usar em produção.**
 *
 * @returns {void}
 * @internal
 */
export function _resetMcpState() {
    resetMcpBridgeState(_defaultMcpBridgeState);
    _defaultMcpBridgeDeps = null;
}

/**
 * Cria uma instância isolada do MCP bridge para testes/DI/múltiplos runtimes.
 *
 * A API pública do módulo continua expondo wrappers sobre um singleton default para preservar backward compatibility.
 *
 * @param {Partial<McpBridgeDeps>} [overrides]
 * @returns {{
 *     getMcpStatus: () => McpHealthStatus;
 *     listMcpTools: () => Promise<McpToolMeta[]>;
 *     buildMcpTools: () => Promise<import('#copilot/sdk/types').Tool<any>[]>;
 *     startMcpAutoReconnect: (
 *         onReconnect: (tools: import('#copilot/sdk/types').Tool[]) => void | Promise<void>,
 *         baseIntervalMs?: number,
 *     ) => () => void;
 *     resetState: () => void;
 * }}
 */
export function createMcpToolBridge(overrides = {}) {
    const state = createMcpBridgeState();
    const deps = resolveMcpBridgeDeps(overrides);
    return {
        getMcpStatus: () => getMcpStatusFromState(state),
        listMcpTools: () => listMcpToolsInternal(deps, { swallowErrors: true }),
        buildMcpTools: () => buildMcpToolsInternal(state, deps),
        startMcpAutoReconnect: (onReconnect, baseIntervalMs) =>
            startMcpAutoReconnectInternal(state, deps, onReconnect, baseIntervalMs),
        resetState: () => resetMcpBridgeState(state),
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
/**
 * @param {McpBridgeState} state
 * @param {McpBridgeDeps} deps
 * @param {(tools: import('#copilot/sdk/types').Tool[]) => void | Promise<void>} onReconnect
 * @param {number} [baseIntervalMs]
 * @returns {() => void}
 */
function startMcpAutoReconnectInternal(state, deps, onReconnect, baseIntervalMs = 5 * 60_000) {
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

            const status = getMcpStatusFromState(state);
            if (!status.circuitOpen && status.available && status.toolCount > 0) {
                // MCP saudável — resetar backoff e reagendar no intervalo base
                _stepIndex = 0;
                scheduleNext();
                return;
            }

            deps.logFn(
                'DEBUG',
                `[mcp-auto-reconnect] Tentando reconectar (step ${_stepIndex}, delay ${delayMs / 1000}s)...`,
            );
            try {
                const tools = await buildMcpToolsInternal(state, deps);
                if (tools.length > 0) {
                    deps.logFn('INFO', `[mcp-auto-reconnect] MCP reconectado: ${tools.length} tools disponíveis`);
                    _stepIndex = 0;
                    await onReconnect(tools);
                } else {
                    // Circuit fechou mas sem tools — avançar backoff
                    _stepIndex = Math.min(_stepIndex + 1, BACKOFF_MULTIPLIERS.length - 1);
                }
            } catch (err) {
                const msg = err instanceof Error ? toError(err).message : String(err);
                deps.logFn('DEBUG', `[mcp-auto-reconnect] Falha na tentativa de reconnect: ${msg}`);
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

/**
 * Wrapper público sobre o MCP bridge default.
 *
 * @param {(tools: import('#copilot/sdk/types').Tool[]) => void | Promise<void>} onReconnect
 * @param {number} [baseIntervalMs]
 * @returns {() => void}
 */
export function startMcpAutoReconnect(onReconnect, baseIntervalMs = 5 * 60_000) {
    return startMcpAutoReconnectInternal(
        _defaultMcpBridgeState,
        getDefaultMcpBridgeDeps(),
        onReconnect,
        baseIntervalMs,
    );
}
