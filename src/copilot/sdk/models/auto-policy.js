// @ts-check
/**
 * @module copilot/sdk/models/auto-policy
 * @file Política local para observar e explicar `model="auto"` sem substituir o roteamento nativo do Copilot.
 */

/** @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort */

/**
 * @typedef {{
 *     enabled: boolean;
 *     preferredModel: string;
 *     preferredReasoningEffort: ReasoningEffort;
 *     mode: 'advisory';
 *     source: 'env' | 'default';
 * }} AutoModelPreference
 *
 *
 * @typedef {{
 *     configuredModel: string;
 *     observedModel: string | null;
 *     preferredModel: string;
 *     preferredReasoningEffort: ReasoningEffort;
 *     preferenceSatisfied: boolean | null;
 *     selectionAuthority: 'github-copilot';
 *     canForcePreference: false;
 *     criteria: readonly string[];
 *     excludedByAuto: readonly string[];
 * }} AutoModelPolicySnapshot
 */

/** @type {readonly string[]} */
export const COPILOT_AUTO_MODEL_PUBLIC_CRITERIA = Object.freeze([
    'available_models',
    'real_time_system_health',
    'task_complexity',
    'model_performance',
    'reduced_rate_limiting',
    'lower_latency_and_errors',
    'admin_model_policies',
    'subscription_or_plan',
    'usage_cost_efficiency',
]);

/** @type {readonly string[]} */
export const COPILOT_AUTO_MODEL_EXCLUDED_CLASSES = Object.freeze([
    'models_excluded_by_admin_policy',
    'models_unavailable_in_plan',
]);

/** @type {Readonly<AutoModelPreference>} */
export const DEFAULT_AUTO_MODEL_PREFERENCE = Object.freeze({
    enabled: true,
    preferredModel: 'gpt-5.4',
    preferredReasoningEffort: 'high',
    mode: 'advisory',
    source: 'default',
});

/** @type {readonly ReasoningEffort[]} */
const VALID_REASONING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']);

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env=process.env] Default is `process.env`
 * @returns {AutoModelPreference}
 */
export function readAutoModelPreference(env = process.env) {
    const preferredModel = env['COPILOT_AUTO_PREFERRED_MODEL']?.trim() || DEFAULT_AUTO_MODEL_PREFERENCE.preferredModel;
    const requestedReasoning = env['COPILOT_AUTO_PREFERRED_REASONING_EFFORT']?.trim();
    const preferredReasoningEffort = VALID_REASONING_EFFORTS.includes(
        /** @type {ReasoningEffort} */ (requestedReasoning),
    )
        ? /** @type {ReasoningEffort} */ (requestedReasoning)
        : DEFAULT_AUTO_MODEL_PREFERENCE.preferredReasoningEffort;
    return {
        enabled: env['COPILOT_AUTO_PREFERENCE_ENABLED'] !== 'false',
        preferredModel,
        preferredReasoningEffort,
        mode: 'advisory',
        source:
            preferredModel !== DEFAULT_AUTO_MODEL_PREFERENCE.preferredModel ||
            preferredReasoningEffort !== DEFAULT_AUTO_MODEL_PREFERENCE.preferredReasoningEffort
                ? 'env'
                : 'default',
    };
}

/**
 * @param {{
 *     configuredModel: string;
 *     observedModel?: string | null;
 *     preference?: AutoModelPreference;
 * }} input
 * @returns {AutoModelPolicySnapshot}
 */
export function describeAutoModelPolicy(input) {
    const preference = input.preference ?? readAutoModelPreference();
    const observedModel = input.observedModel ?? null;
    return {
        configuredModel: input.configuredModel,
        observedModel,
        preferredModel: preference.preferredModel,
        preferredReasoningEffort: preference.preferredReasoningEffort,
        preferenceSatisfied:
            input.configuredModel === 'auto' && observedModel ? observedModel === preference.preferredModel : null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
        criteria: COPILOT_AUTO_MODEL_PUBLIC_CRITERIA,
        excludedByAuto: COPILOT_AUTO_MODEL_EXCLUDED_CLASSES,
    };
}
