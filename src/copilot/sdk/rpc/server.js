// @ts-check
/**
 * src/copilot/sdk/server-rpc.js
 *
 * Façade tipada para os RPCs server-scoped (CopilotClient.rpc):
 *
 * - ping: echo + timestamp + protocolVersion
 * - models.list: lista modelos com capabilities/limits/billing
 * - tools.list: lista tools disponíveis (built-in + MCP)
 * - account.getQuota: snapshot de quota por tipo (chat, completions, premium)
 *
 * Diferente de `rpc.js` (session-scoped), estas operações NÃO exigem sessão ativa. Exigem apenas um CopilotClient
 * conectado.
 *
 * @module copilot/sdk/server-rpc
 * @see EventBus
 * @see module:copilot/sdk/rpc
 * @see module:copilot/sdk/health
 */

import { toSdkOperationError } from '../errors.js';
import { isExperimentalEnabled } from '../feature-flags.js';
import { log as appLog } from '../logger.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {{ message: string; timestamp: string; protocolVersion?: number }} PingResult
 *
 * @typedef {{
 *     id: string;
 *     name: string;
 *     capabilities: {
 *         supports: { vision?: boolean; reasoningEffort?: boolean };
 *         limits: { max_prompt_tokens?: number; max_output_tokens?: number; max_context_window_tokens: number };
 *     };
 *     policy?: { state: string; terms: string };
 *     billing?: { multiplier: number };
 *     supportedReasoningEfforts?: string[];
 *     defaultReasoningEffort?: string;
 * }} ModelInfo
 *
 *
 * @typedef {{ models: ModelInfo[] }} ModelsListResult
 *
 * @typedef {{
 *     name: string;
 *     namespacedName?: string;
 *     description: string;
 *     parameters?: Record<string, unknown>;
 *     instructions?: string;
 * }} ToolInfo
 *
 *
 * @typedef {{ tools: ToolInfo[] }} ToolsListResult
 *
 * @typedef {{
 *     entitlementRequests: number;
 *     usedRequests: number;
 *     remainingPercentage: number;
 *     overage: number;
 *     overageAllowedWithExhaustedQuota: boolean;
 *     resetDate?: string;
 * }} QuotaSnapshot
 *
 *
 * @typedef {{ quotaSnapshots: Record<string, QuotaSnapshot> }} AccountQuotaResult
 *
 * @typedef {{ servers?: Record<string, unknown>; [k: string]: unknown }} McpConfigListResult
 *
 * @typedef {{ success?: boolean; [k: string]: unknown }} ServerMutationResult
 *
 * @typedef {{ servers?: unknown[]; [k: string]: unknown }} McpDiscoverResult
 *
 * @typedef {{ skills?: unknown[]; [k: string]: unknown }} SkillsDiscoverResult
 *
 * @typedef {{ sessionId?: string; [k: string]: unknown }} SessionForkResult
 */

// ─── Validação ─────────────────────────────────────────────────────────────────

/**
 * Valida que o client existe e possui a propriedade `rpc`.
 *
 * @param {unknown} client
 * @param {string} caller
 * @returns {asserts client is CopilotClient}
 */
function assertClient(client, caller) {
    if (!client || typeof client !== 'object' || !('rpc' in client)) {
        throw new TypeError(
            `[sdk/server-rpc/${caller}] CopilotClient inválido ou não conectado. Verifique getClient().`,
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Envia ping ao servidor e retorna echo + timestamp + protocolVersion.
 *
 * @param {CopilotClient} client
 * @param {string} [message] - Mensagem opcional para echo
 * @returns {Promise<PingResult>}
 */
export async function ping(client, message) {
    assertClient(client, 'ping');
    /** @type {Record<string, unknown>} */
    const params = {};
    if (message) params['message'] = message;

    appLog('DEBUG', `[sdk/server-rpc] ping: message='${message ?? ''}'`);
    try {
        return /** @type {PingResult} */ (
            /** @type {unknown} */ (await client.rpc.ping(/** @type {{ message?: string }} */ (params)))
        );
    } catch (error) {
        throw toSdkOperationError('server.ping', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista todos os modelos disponíveis com metadata completa.
 *
 * @param {CopilotClient} client
 * @returns {Promise<ModelsListResult>}
 */
export async function modelsList(client) {
    assertClient(client, 'models.list');
    appLog('DEBUG', '[sdk/server-rpc] models.list');
    try {
        return /** @type {ModelsListResult} */ (/** @type {unknown} */ (await client.rpc.models.list({})));
    } catch (error) {
        throw toSdkOperationError('server.models.list', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista todas as tools disponíveis (built-in + MCP).
 *
 * @param {CopilotClient} client
 * @param {{ model?: string }} [options] - Filtro opcional por modelo
 * @returns {Promise<ToolsListResult>}
 */
export async function toolsList(client, options) {
    assertClient(client, 'tools.list');
    /** @type {Record<string, unknown>} */
    const params = {};
    if (options?.model) params['model'] = options.model;

    appLog('DEBUG', `[sdk/server-rpc] tools.list: model='${options?.model ?? 'all'}'`);
    try {
        return /** @type {ToolsListResult} */ (await client.rpc.tools.list(/** @type {{ model?: string }} */ (params)));
    } catch (error) {
        throw toSdkOperationError('server.tools.list', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT / QUOTA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna snapshot de quota da conta por tipo (chat, completions, premium_interactions).
 *
 * @param {CopilotClient} client
 * @returns {Promise<AccountQuotaResult>}
 */
export async function accountGetQuota(client) {
    assertClient(client, 'account.getQuota');
    appLog('DEBUG', '[sdk/server-rpc] account.getQuota');
    try {
        return /** @type {AccountQuotaResult} */ (/** @type {unknown} */ (await client.rpc.account.getQuota({})));
    } catch (error) {
        throw toSdkOperationError('server.account.getQuota', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP CONFIG / DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {CopilotClient} client
 * @returns {Promise<McpConfigListResult>}
 */
export async function mcpConfigList(client) {
    assertClient(client, 'mcp.config.list');
    try {
        return /** @type {McpConfigListResult} */ (/** @type {unknown} */ (await client.rpc.mcp.config.list()));
    } catch (error) {
        throw toSdkOperationError('server.mcp.config.list', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {Record<string, unknown>} params
 * @returns {Promise<ServerMutationResult>}
 */
export async function mcpConfigAdd(client, params) {
    assertClient(client, 'mcp.config.add');
    try {
        await client.rpc.mcp.config.add(/** @type {any} */ (params));
        return { success: true };
    } catch (error) {
        throw toSdkOperationError('server.mcp.config.add', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {Record<string, unknown>} params
 * @returns {Promise<ServerMutationResult>}
 */
export async function mcpConfigUpdate(client, params) {
    assertClient(client, 'mcp.config.update');
    try {
        await client.rpc.mcp.config.update(/** @type {any} */ (params));
        return { success: true };
    } catch (error) {
        throw toSdkOperationError('server.mcp.config.update', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {{ name: string }} params
 * @returns {Promise<ServerMutationResult>}
 */
export async function mcpConfigRemove(client, params) {
    assertClient(client, 'mcp.config.remove');
    try {
        await client.rpc.mcp.config.remove(params);
        return { success: true };
    } catch (error) {
        throw toSdkOperationError('server.mcp.config.remove', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {{ names: string[] }} params
 * @returns {Promise<ServerMutationResult>}
 */
export async function mcpConfigEnable(client, params) {
    assertClient(client, 'mcp.config.enable');
    try {
        await client.rpc.mcp.config.enable(params);
        return { success: true };
    } catch (error) {
        throw toSdkOperationError('server.mcp.config.enable', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {{ names: string[] }} params
 * @returns {Promise<ServerMutationResult>}
 */
export async function mcpConfigDisable(client, params) {
    assertClient(client, 'mcp.config.disable');
    try {
        await client.rpc.mcp.config.disable(params);
        return { success: true };
    } catch (error) {
        throw toSdkOperationError('server.mcp.config.disable', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {Record<string, unknown>} [params]
 * @returns {Promise<McpDiscoverResult>}
 */
export async function mcpDiscover(client, params = {}) {
    assertClient(client, 'mcp.discover');
    try {
        return /** @type {McpDiscoverResult} */ (await client.rpc.mcp.discover(/** @type {any} */ (params)));
    } catch (error) {
        throw toSdkOperationError('server.mcp.discover', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILLS CONFIG / DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {CopilotClient} client
 * @param {{ disabledSkills: string[] }} params
 * @returns {Promise<ServerMutationResult>}
 */
export async function skillsConfigSetDisabledSkills(client, params) {
    assertClient(client, 'skills.config.setDisabledSkills');
    try {
        await client.rpc.skills.config.setDisabledSkills(params);
        return { success: true };
    } catch (error) {
        throw toSdkOperationError('server.skills.config.setDisabledSkills', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {Record<string, unknown>} [params]
 * @returns {Promise<SkillsDiscoverResult>}
 */
export async function skillsDiscover(client, params = {}) {
    assertClient(client, 'skills.discover');
    try {
        return /** @type {SkillsDiscoverResult} */ (await client.rpc.skills.discover(/** @type {any} */ (params)));
    } catch (error) {
        throw toSdkOperationError('server.skills.discover', error);
    }
}

/**
 * @param {CopilotClient} client
 * @param {Record<string, unknown>} params
 * @returns {Promise<SessionForkResult>}
 */
export async function sessionsFork(client, params) {
    if (!isExperimentalEnabled('sessions')) {
        throw new Error("[sdk/server-rpc/sessions.fork] requer feature flag 'sessions' habilitada.");
    }
    assertClient(client, 'sessions.fork');
    try {
        return /** @type {SessionForkResult} */ (await client.rpc.sessions.fork(/** @type {any} */ (params)));
    } catch (error) {
        throw toSdkOperationError('server.sessions.fork', error);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACADE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cria façade ergonômico agrupando todos os RPCs server-scoped.
 *
 * @param {CopilotClient} client
 * @returns {{
 *     ping: (message?: string) => Promise<PingResult>;
 *     models: { list: () => Promise<ModelsListResult> };
 *     tools: { list: (options?: { model?: string }) => Promise<ToolsListResult> };
 *     account: { getQuota: () => Promise<AccountQuotaResult> };
 *     mcp: {
 *         config: {
 *             list: () => Promise<McpConfigListResult>;
 *             add: (params: Record<string, unknown>) => Promise<ServerMutationResult>;
 *             update: (params: Record<string, unknown>) => Promise<ServerMutationResult>;
 *             remove: (params: { name: string }) => Promise<ServerMutationResult>;
 *             enable: (params: { names: string[] }) => Promise<ServerMutationResult>;
 *             disable: (params: { names: string[] }) => Promise<ServerMutationResult>;
 *         };
 *         discover: (params?: Record<string, unknown>) => Promise<McpDiscoverResult>;
 *     };
 *     skills: {
 *         config: { setDisabledSkills: (params: { disabledSkills: string[] }) => Promise<ServerMutationResult> };
 *         discover: (params?: Record<string, unknown>) => Promise<SkillsDiscoverResult>;
 *     };
 *     sessions: { fork: (params: Record<string, unknown>) => Promise<SessionForkResult> };
 * }}
 */
export function createServerRpcFacade(client) {
    assertClient(client, 'createServerRpcFacade');
    return {
        ping: (message) => ping(client, message),
        models: { list: () => modelsList(client) },
        tools: { list: (options) => toolsList(client, options) },
        account: { getQuota: () => accountGetQuota(client) },
        mcp: {
            config: {
                list: () => mcpConfigList(client),
                add: (params) => mcpConfigAdd(client, params),
                update: (params) => mcpConfigUpdate(client, params),
                remove: (params) => mcpConfigRemove(client, params),
                enable: (params) => mcpConfigEnable(client, params),
                disable: (params) => mcpConfigDisable(client, params),
            },
            discover: (params) => mcpDiscover(client, params),
        },
        skills: {
            config: { setDisabledSkills: (params) => skillsConfigSetDisabledSkills(client, params) },
            discover: (params) => skillsDiscover(client, params),
        },
        sessions: { fork: (params) => sessionsFork(client, params) },
    };
}
