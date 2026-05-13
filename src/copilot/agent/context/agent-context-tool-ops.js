// @ts-check
/**
 * src/copilot/agent/context/agent-context-tool-ops.js
 *
 * Operações sobre o registry de tools e permissions do AgentContext que NÃO dependem dos campos privados `#factories` /
 * `#factoryHost`. Extraídas de `agent-context.js` na Faixa C3.1.
 *
 * Nota: `resetToolsRegistry`, `getPermissionCapabilitySnapshot` e `getContextFactoryCapabilitiesSnapshot` permanecem em
 * `agent-context.js` por dependerem de campos privados da classe.
 *
 * @module copilot/agent/context/agent-context-tool-ops
 * @internal
 */

import { normalizeToolRegistryEntry } from './agent-context-helpers.js';

/**
 * Contrato mínimo do contexto para operações de tool registry e permissions.
 *
 * @typedef {{
 *     toolsRegistry: import('#copilot/sdk/tools-registry').ToolRegistry;
 *     permissions: import('../ports/permission-port.js').AgentPermissionController;
 *     toolSessionContext: import('#copilot/sdk').ToolSessionContext;
 *     invalidateStatusSnapshot: () => void;
 * }} ToolOpsCtx
 */

// ─── Tool Registry ────────────────────────────────────────────────────────────

/**
 * Retorna o registry ativo de tools.
 *
 * @param {ToolOpsCtx} ctx
 * @returns {import('#copilot/sdk/tools-registry').ToolRegistry}
 */
export function getToolRegistrySnapshot(ctx) {
    return ctx.toolsRegistry;
}

/**
 * Retorna leitura defensiva e serializável das tools registradas no runtime.
 *
 * @param {ToolOpsCtx} ctx
 * @returns {{
 *     name: string;
 *     description: string | null;
 *     category: string;
 *     tags: string[];
 *     readOnly: boolean;
 *     skipPermission: boolean;
 *     hasParameters: boolean;
 * }[]}
 */
export function getToolRegistryEntriesSnapshot(ctx) {
    const registry = ctx.toolsRegistry;
    if (!(registry?.entries instanceof Map)) return [];
    return [...registry.entries.entries()].map(([name, entry]) => normalizeToolRegistryEntry(name, entry));
}

// ─── Permissions ──────────────────────────────────────────────────────────────

/**
 * Retorna o modo de permissão efetivo sem expor o controller vivo.
 *
 * @param {ToolOpsCtx} ctx
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
export function getPermissionModeSnapshot(ctx) {
    return ctx.permissions.getMode();
}

/**
 * Atualiza a policy de permissão de tools e invalida o snapshot cacheado.
 *
 * @param {ToolOpsCtx} ctx
 * @param {'approve_all' | 'audit_only' | 'selective'} mode
 * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts]
 * @returns {void}
 */
export function setPermissionMode(ctx, mode, opts = {}) {
    ctx.permissions.setMode(mode, opts);
    ctx.invalidateStatusSnapshot();
}

/**
 * Retorna o handler SDK de permissões atualmente governado pelo contexto.
 *
 * @param {ToolOpsCtx} ctx
 * @returns {import('#copilot/sdk/types').PermissionHandler}
 */
export function getPermissionHandlerSnapshot(ctx) {
    return ctx.permissions.handler;
}

/**
 * Retorna snapshot detalhado da policy de permissões ativa (modo, allow/deny lists, denyShell, etc.).
 *
 * @param {ToolOpsCtx} ctx
 * @returns {import('../ports/permission-port.js').PermissionPolicySnapshot | null}
 */
export function getPermissionPolicySnapshot(ctx) {
    return typeof ctx.permissions.getPolicySnapshot === 'function' ? ctx.permissions.getPolicySnapshot() : null;
}

/**
 * @param {ToolOpsCtx} ctx
 * @returns {import('#copilot/sdk').ToolSessionContext}
 */
export function getToolSessionContext(ctx) {
    return ctx.toolSessionContext;
}
