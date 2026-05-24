// @ts-check
/**
 * Canonical task profiles for the model-gateway policy engine.
 *
 * Profiles describe the job, not a vendor. Later scoring can rank candidates, but every router should agree on these
 * baseline requirements and preferences first.
 *
 * @module copilot/model-gateway/routing/task-profiles
 */

export const MODEL_GATEWAY_TASK_PROFILES = Object.freeze({
    cheap_chat: Object.freeze({
        id: 'cheap_chat',
        displayName: 'Cheap chat',
        requires: Object.freeze(['text', 'streaming']),
        prefers: Object.freeze(['free', 'low_cost', 'low_latency']),
        minContextWindowTokens: 8_000,
        requireAgentProbeOk: false,
    }),
    code: Object.freeze({
        id: 'code',
        displayName: 'Code',
        requires: Object.freeze(['text', 'streaming']),
        prefers: Object.freeze(['reasoningEffort', 'large_context', 'low_latency']),
        minContextWindowTokens: 32_000,
        requireAgentProbeOk: false,
    }),
    repo_agent: Object.freeze({
        id: 'repo_agent',
        displayName: 'Repo agent',
        requires: Object.freeze(['text', 'streaming', 'tools']),
        prefers: Object.freeze(['large_context', 'reasoningEffort', 'runtime_proved']),
        minContextWindowTokens: 64_000,
        requireAgentProbeOk: true,
    }),
    tool_agent: Object.freeze({
        id: 'tool_agent',
        displayName: 'Tool agent',
        requires: Object.freeze(['text', 'streaming', 'tools']),
        prefers: Object.freeze(['forcedToolChoice', 'parallelToolCalls', 'runtime_proved']),
        minContextWindowTokens: 32_000,
        requireAgentProbeOk: true,
    }),
    json_extraction: Object.freeze({
        id: 'json_extraction',
        displayName: 'JSON extraction',
        requires: Object.freeze(['text', 'streaming']),
        prefers: Object.freeze(['structuredOutputs', 'jsonMode', 'jsonSchema', 'runtime_proved']),
        minContextWindowTokens: 16_000,
        requireAgentProbeOk: false,
    }),
    vision: Object.freeze({
        id: 'vision',
        displayName: 'Vision',
        requires: Object.freeze(['text', 'streaming', 'vision']),
        prefers: Object.freeze(['large_context', 'runtime_proved']),
        minContextWindowTokens: 16_000,
        requireAgentProbeOk: false,
    }),
    deep_reasoning: Object.freeze({
        id: 'deep_reasoning',
        displayName: 'Deep reasoning',
        requires: Object.freeze(['text', 'streaming']),
        prefers: Object.freeze(['reasoningEffort', 'reasoningBudgetTokens', 'large_context']),
        minContextWindowTokens: 64_000,
        requireAgentProbeOk: false,
    }),
    local_private: Object.freeze({
        id: 'local_private',
        displayName: 'Local/private',
        requires: Object.freeze(['text', 'streaming']),
        prefers: Object.freeze(['local', 'privacy', 'no_remote_secrets']),
        minContextWindowTokens: 8_000,
        requireAgentProbeOk: false,
    }),
});

/**
 * @returns {Array<(typeof MODEL_GATEWAY_TASK_PROFILES)[keyof typeof MODEL_GATEWAY_TASK_PROFILES]>}
 */
export function listModelGatewayTaskProfiles() {
    return Object.values(MODEL_GATEWAY_TASK_PROFILES);
}

/**
 * @param {string | null | undefined} id
 * @returns {(typeof MODEL_GATEWAY_TASK_PROFILES)[keyof typeof MODEL_GATEWAY_TASK_PROFILES] | null}
 */
export function resolveModelGatewayTaskProfile(id) {
    if (typeof id !== 'string') return null;
    const normalized = id.trim().toLowerCase().replace(/[-\s]+/gu, '_');
    return MODEL_GATEWAY_TASK_PROFILES[/** @type {keyof typeof MODEL_GATEWAY_TASK_PROFILES} */ (normalized)] ?? null;
}

