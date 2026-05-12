// @ts-check
/**
 * src/copilot/agent/ports/mcp-port.js
 *
 * Porta compatível entre o runtime do agent e o bridge MCP.
 *
 * O agent usa MCP como uma capability de composição, não como domínio próprio. Por isso, lifecycle/session consomem
 * apenas estas funções: elas escondem onde ficam config, tool bridge e auto-reconnect enquanto o runtime evolui para
 * capabilities explícitas.
 *
 * @module copilot/agent/ports/mcp-port
 * @internal
 */

import * as mcpToolBridge from '../../bridges/mcp-tool-bridge.js';
import { buildMcpConfig } from '../../config/mcp-servers.js';

/**
 * @typedef {object} AgentMcpCapability
 * @property {() => Promise<import('#copilot/sdk/types').Tool[]>} buildTools
 * @property {() => Record<string, unknown> | null} buildConfig
 * @property {(onTools: (tools: import('#copilot/sdk/types').Tool[]) => void, intervalMs: number) => () => void} startAutoReconnect
 * @property {(() => unknown) | undefined} [getStatus]
 */

/** @type {AgentMcpCapability | null} */
let _defaultAgentMcpCapability = null;

/**
 * @param {string} exportName
 * @returns {boolean}
 */
function hasBridgeExport(exportName) {
    return Object.prototype.hasOwnProperty.call(mcpToolBridge, exportName);
}

/**
 * Builder de tools MCP usado pelo runtime quando nenhum bridge MCP injetado está ativo.
 *
 * @returns {Promise<import('#copilot/sdk/types').Tool[]>}
 */
export function buildDefaultMcpTools() {
    return hasBridgeExport('buildMcpTools') && typeof mcpToolBridge.buildMcpTools === 'function'
        ? mcpToolBridge.buildMcpTools()
        : Promise.resolve([]);
}

/**
 * Snapshot de configuração MCP no formato aceito pelo SDK.
 *
 * Retorna `null` quando não há servidores MCP configurados. O retorno usa `Record<string, unknown>` porque o shape
 * concreto vem da configuração e é validado na borda do SDK.
 *
 * @returns {Record<string, unknown> | null}
 */
export function buildDefaultMcpConfig() {
    return /** @type {Record<string, unknown> | null} */ (buildMcpConfig() ?? null);
}

/**
 * Inicia o auto-reconnect MCP default.
 *
 * `onTools` recebe a lista reconstruída de tools e deve atualizar o registry/bridge do runtime sem assumir que a sessão
 * SDK atual foi recriada.
 *
 * @param {(tools: import('#copilot/sdk/types').Tool[]) => void} onTools
 * @param {number} intervalMs
 * @returns {() => void}
 */
export function startDefaultMcpAutoReconnect(onTools, intervalMs) {
    return hasBridgeExport('startMcpAutoReconnect') && typeof mcpToolBridge.startMcpAutoReconnect === 'function'
        ? mcpToolBridge.startMcpAutoReconnect(onTools, intervalMs)
        : () => {};
}

/**
 * @param {unknown} value
 * @returns {value is AgentMcpCapability}
 */
function isAgentMcpCapability(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof (/** @type {Record<string, unknown>} */ (value).buildTools) === 'function' &&
        typeof (/** @type {Record<string, unknown>} */ (value).buildConfig) === 'function' &&
        typeof (/** @type {Record<string, unknown>} */ (value).startAutoReconnect) === 'function',
    );
}

/**
 * @param {unknown} value
 * @returns {value is ReturnType<NonNullable<typeof mcpToolBridge.createMcpToolBridge>>}
 */
function isNativeMcpBridgeInstance(value) {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof (/** @type {Record<string, unknown>} */ (value).buildMcpTools) === 'function' &&
        typeof (/** @type {Record<string, unknown>} */ (value).startMcpAutoReconnect) === 'function',
    );
}

/**
 * @param {ReturnType<NonNullable<typeof mcpToolBridge.createMcpToolBridge>>} bridge
 * @returns {AgentMcpCapability}
 */
function adaptNativeMcpBridgeToAgentCapability(bridge) {
    return {
        buildTools: () => bridge.buildMcpTools(),
        buildConfig: () => buildDefaultMcpConfig(),
        startAutoReconnect: (onTools, intervalMs) => bridge.startMcpAutoReconnect(onTools, intervalMs),
        ...(typeof bridge.getMcpStatus === 'function' ? { getStatus: () => bridge.getMcpStatus() } : {}),
    };
}

/**
 * Normaliza uma implementação MCP injetada para o contrato canônico do runtime do agent.
 *
 * Aceita tanto a capability já adaptada (`buildTools/buildConfig/startAutoReconnect`) quanto a factory nativa do bridge
 * (`buildMcpTools/startMcpAutoReconnect`) para preservar compatibilidade progressiva durante a migração.
 *
 * @param {unknown} value
 * @returns {AgentMcpCapability | null}
 */
export function normalizeAgentMcpCapability(value) {
    if (isAgentMcpCapability(value)) {
        return value;
    }
    if (isNativeMcpBridgeInstance(value)) {
        return adaptNativeMcpBridgeToAgentCapability(value);
    }
    return null;
}

/**
 * Cria a capability MCP default do runtime usando uma instância própria do bridge quando disponível.
 *
 * Isso garante isolamento de estado por runtime/agent sem expor `createMcpToolBridge()` às camadas de lifecycle. Em
 * ambientes de teste com mocks parciais do bridge, cai automaticamente para os wrappers default compatíveis.
 *
 * @returns {AgentMcpCapability}
 */
export function createDefaultAgentMcpCapability() {
    if (hasBridgeExport('createMcpToolBridge') && typeof mcpToolBridge.createMcpToolBridge === 'function') {
        return adaptNativeMcpBridgeToAgentCapability(mcpToolBridge.createMcpToolBridge());
    }
    return {
        buildTools: () => buildDefaultMcpTools(),
        buildConfig: () => buildDefaultMcpConfig(),
        startAutoReconnect: (onTools, intervalMs) => startDefaultMcpAutoReconnect(onTools, intervalMs),
        ...(hasBridgeExport('getMcpStatus') && typeof mcpToolBridge.getMcpStatus === 'function'
            ? { getStatus: () => mcpToolBridge.getMcpStatus() }
            : {}),
    };
}

/**
 * @returns {AgentMcpCapability}
 */
export function getDefaultAgentMcpCapability() {
    if (_defaultAgentMcpCapability === null) {
        _defaultAgentMcpCapability = createDefaultAgentMcpCapability();
    }
    return _defaultAgentMcpCapability;
}

/**
 * Resolve a capability MCP efetiva do runtime. Quando nenhuma foi injetada, usa a capability default compatível.
 *
 * @param {unknown} value
 * @returns {AgentMcpCapability}
 */
export function resolveAgentMcpCapability(value) {
    return normalizeAgentMcpCapability(value) ?? getDefaultAgentMcpCapability();
}

/**
 * Lê a capability MCP efetiva a partir de um contexto de runtime/lifecycle sem vazar knowledge do shape interno.
 *
 * @param {{
 *     getMcpBridgeSnapshot?: (() => unknown) | undefined;
 *     mcpBridge?: unknown;
 * }} ctx
 * @returns {AgentMcpCapability}
 */
export function readAgentMcpCapabilitySnapshot(ctx) {
    const injected =
        typeof ctx?.getMcpBridgeSnapshot === 'function' ? ctx.getMcpBridgeSnapshot() : (ctx?.mcpBridge ?? null);
    return resolveAgentMcpCapability(injected);
}

/**
 * Reset de cache da capability default para isolamento de testes.
 *
 * @returns {void}
 * @internal
 */
export function _resetDefaultAgentMcpCapabilityForTests() {
    _defaultAgentMcpCapability = null;
}
