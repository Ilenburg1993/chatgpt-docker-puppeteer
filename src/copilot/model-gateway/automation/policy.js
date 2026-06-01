// @ts-check
/**
 * Runtime automation policy for model-gateway.
 *
 * Defaults are intentionally conservative: status/plan can run any time, but live model switching, new SDK sessions,
 * local private providers and provider execution stay opt-in.
 *
 * @module copilot/model-gateway/automation/policy
 */

export const MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV = Object.freeze({
    enabled: 'COPILOT_BYOK_GATEWAY_AUTO',
    policy: 'COPILOT_BYOK_GATEWAY_AUTO_POLICY',
    profiles: 'COPILOT_BYOK_GATEWAY_AUTO_PROFILES',
    allowLiveSetModel: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL',
    allowNewSession: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION',
    allowProviderProbes: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES',
    allowLocalPrivate: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE',
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function truthy(value) {
    return /^(1|true|yes|sim|on|enabled|enable|allow|allowed)$/iu.test(String(value ?? '').trim());
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function csv(value) {
    return String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{
 *   enabled: boolean;
 *   policy: string;
 *   profiles: string[];
 *   allowLiveSetModel: boolean;
 *   allowNewSession: boolean;
 *   allowProviderProbes: boolean;
 *   allowLocalPrivate: boolean;
 * }}
 */
export function readModelGatewayRuntimeAutomationPolicy(env = process.env) {
    return {
        enabled: truthy(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.enabled]),
        policy: String(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.policy] || 'prefer_runtime_proved').trim() || 'prefer_runtime_proved',
        profiles: csv(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.profiles]),
        allowLiveSetModel: truthy(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.allowLiveSetModel]),
        allowNewSession: truthy(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.allowNewSession]),
        allowProviderProbes: truthy(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.allowProviderProbes]),
        allowLocalPrivate: truthy(env[MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV.allowLocalPrivate]),
    };
}
