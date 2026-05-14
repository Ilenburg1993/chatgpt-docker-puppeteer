// @ts-check
/**
 * @module copilot/agent/runtime/governance-readers
 * @file Leitores internos canônicos de governance do runtime do agent.
 *
 *   Módulo interno neutro para reduzir imports cruzados entre facades de mutation/projection.
 */

/**
 * @typedef {{
 *     getPermissionModeSnapshot?: (() => 'approve_all' | 'audit_only' | 'selective') | undefined;
 *     getPermissionMode?: (() => 'approve_all' | 'audit_only' | 'selective') | undefined;
 *     getPermissionCapabilitySnapshot?:
 *         | (() => { mode: 'approve_all' | 'audit_only' | 'selective'; handlerAvailable: boolean })
 *         | undefined;
 *     getPermissionPolicySnapshot?: (() => unknown) | undefined;
 *     getContextFactoryCapabilitiesSnapshot?: (() => Record<string, Record<string, unknown>>) | undefined;
 *     getToolRegistrySnapshot?: (() => import('#copilot/sdk/types').ToolRegistry) | undefined;
 *     getToolRegistryEntriesSnapshot?:
 *         | (() => {
 *               name: string;
 *               description: string | null;
 *               category: string;
 *               tags: string[];
 *               readOnly: boolean;
 *               skipPermission: boolean;
 *           }[])
 *         | undefined;
 *     getToolSessionContext?: (() => import('#copilot/sdk/types').ToolSessionContext) | undefined;
 *     toolSessionContext?: import('#copilot/sdk/types').ToolSessionContext | undefined;
 * }} AgentRuntimeGovernanceTarget
 */

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
export function readRuntimePermissionMode(runtime) {
    return runtime.getPermissionModeSnapshot?.() ?? runtime.getPermissionMode?.() ?? 'approve_all';
}

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {ReturnType<import('../agent-context.js').AgentContext['getPermissionCapabilitySnapshot']>}
 */
export function readRuntimePermissionCapability(runtime) {
    return (
        runtime.getPermissionCapabilitySnapshot?.() ?? {
            mode: readRuntimePermissionMode(runtime),
            handlerAvailable: false,
        }
    );
}

/**
 * Retorna snapshot detalhado da policy ativa (mode, allowTools, denyTools, denyShell, defaultDecision).
 *
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {unknown}
 */
export function readRuntimePermissionPolicySnapshot(runtime) {
    return runtime.getPermissionPolicySnapshot?.() ?? null;
}

/**
 * Retorna o ToolSessionContext vivo sem expor `AgentContext` como contrato público do runtime.
 *
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {import('#copilot/sdk/types').ToolSessionContext}
 */
export function readRuntimeToolSessionContext(runtime) {
    const context = runtime.getToolSessionContext?.() ?? runtime.toolSessionContext;
    if (!context) {
        throw new Error('AGENT_RUNTIME_TOOL_SESSION_CONTEXT_UNAVAILABLE');
    }
    return context;
}

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {ReturnType<import('../agent-context.js').AgentContext['getContextFactoryCapabilitiesSnapshot']>}
 */
export function readRuntimeContextFactoryCapabilities(runtime) {
    return runtime.getContextFactoryCapabilitiesSnapshot?.() ?? {};
}

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {ReturnType<import('../agent-context.js').AgentContext['getToolRegistrySnapshot']>}
 */
export function readRuntimeToolRegistry(runtime) {
    const registry = runtime.getToolRegistrySnapshot?.();
    if (!registry) throw new Error('AGENT_RUNTIME_TOOL_REGISTRY_UNAVAILABLE');
    return registry;
}

/**
 * @param {AgentRuntimeGovernanceTarget} runtime
 * @returns {ReturnType<import('../agent-context.js').AgentContext['getToolRegistryEntriesSnapshot']>}
 */
export function readRuntimeToolRegistryEntries(runtime) {
    return runtime.getToolRegistryEntriesSnapshot?.() ?? [];
}
