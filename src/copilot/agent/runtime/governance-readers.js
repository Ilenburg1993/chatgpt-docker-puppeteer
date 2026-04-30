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
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getPermissionCapabilitySnapshot']>)
 *         | undefined;
 *     getContextFactoryCapabilitiesSnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getContextFactoryCapabilitiesSnapshot']>)
 *         | undefined;
 *     getToolRegistrySnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getToolRegistrySnapshot']>)
 *         | undefined;
 *     getToolRegistryEntriesSnapshot?:
 *         | (() => ReturnType<import('../agent-context.js').AgentContext['getToolRegistryEntriesSnapshot']>)
 *         | undefined;
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
