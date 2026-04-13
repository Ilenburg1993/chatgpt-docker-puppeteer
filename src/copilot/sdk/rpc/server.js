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

import { log as appLog } from '../logger.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {{ message: string; timestamp: number; protocolVersion: number }} PingResult
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
    return client.rpc.ping(/** @type {any} */ (params));
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
    return client.rpc.models.list();
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
    return client.rpc.tools.list(/** @type {any} */ (params));
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
    return client.rpc.account.getQuota();
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
 * }}
 */
export function createServerRpcFacade(client) {
    assertClient(client, 'createServerRpcFacade');
    return {
        ping: (message) => ping(client, message),
        models: { list: () => modelsList(client) },
        tools: { list: (options) => toolsList(client, options) },
        account: { getQuota: () => accountGetQuota(client) },
    };
}
