// @ts-check

import { listInferenceProfiles } from '../infra/db/inference_profile_repo.js';
import { listInferenceClientPolicies } from '../infra/db/inference_client_policy_repo.js';

/**
 * @typedef {object} InferencePolicyLayer
 * @property {number|null} [timeout_ms]
 * @property {number|null} [max_parallel]
 * @property {number|null} [max_tokens]
 * @property {string[]|null} [allowed_models]
 * @property {string[]|null} [allowed_backends]
 * @property {string|null} [degraded_behavior]
 * @property {string} [profile_id]
 * @property {string|null} [profile_name]
 */

/**
 * @typedef {object} InferencePolicyPersistenceSnapshot
 * @property {Record<string, InferencePolicyLayer>} profilePolicies
 * @property {Record<string, InferencePolicyLayer>} clientPolicies
 * @property {{ profileCount:number, clientPolicyCount:number }} meta
 */

function asPlainObject(value, fallback = {}) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

/**
 * @typedef {object} ProfileToPolicyLayerProfile
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Converte profile persistido para layer compatível com `resolveInferencePolicy`.
 * @param {ProfileToPolicyLayerProfile} profile
 */
function profileToPolicyLayer(profile) {
    const generation = asPlainObject(profile?.generation_params_json, {});
    const budget = asPlainObject(profile?.budget_policy_json, {});
    const validation = asPlainObject(profile?.validation_policy_json, {});

    return {
        timeout_ms: budget.timeout_ms ?? budget.timeoutMs ?? null,
        max_parallel: budget.max_parallel ?? budget.maxParallel ?? null,
        max_tokens: generation.max_tokens ?? generation.maxTokens ?? budget.max_tokens ?? null,
        allowed_models: validation.allowed_models ?? validation.allowedModels ?? null,
        allowed_backends: validation.allowed_backends ?? validation.allowedBackends ?? null,
        degraded_behavior: budget.degraded_behavior ?? budget.degradedBehavior ?? null,
    };
}

/**
 * @typedef {object} ClientPolicyToLayerPolicy
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Converte policy de cliente persistida para layer compatível com `resolveInferencePolicy`.
 * @param {ClientPolicyToLayerPolicy} policy
 */
function clientPolicyToLayer(policy) {
    const degraded = asPlainObject(policy?.degraded_behavior_json, {});
    return {
        timeout_ms: policy?.timeout_ms ?? null,
        max_parallel: policy?.max_parallel ?? null,
        allowed_models: Array.isArray(policy?.allowed_models_json) ? policy.allowed_models_json : null,
        allowed_backends: Array.isArray(policy?.allowed_backends_json) ? policy.allowed_backends_json : null,
        degraded_behavior: degraded.mode ?? degraded.behavior ?? degraded.degraded_behavior ?? null,
    };
}

/**
 * Carrega profiles/policies persistidos do SQLite.
 * @returns {InferencePolicyPersistenceSnapshot}
 */
export function loadInferencePoliciesFromDb() {
    const profiles = listInferenceProfiles({ enabledOnly: true, limit: 500 });
    const clientPolicies = listInferenceClientPolicies({ enabledOnly: true, limit: 500 });
    const profileIdToName = new Map();

    /** @type {Record<string, InferencePolicyLayer>} */
    const profileMap = Object.create(null);
    for (const profile of profiles) {
        if (!profile?.name) continue;
        if (profile.id) profileIdToName.set(String(profile.id), String(profile.name));
        profileMap[String(profile.name)] = profileToPolicyLayer(profile);
    }

    /** @type {Record<string, InferencePolicyLayer>} */
    const clientMap = Object.create(null);
    for (const policy of clientPolicies) {
        if (!policy?.client_tag) continue;
        const layer = clientPolicyToLayer(policy);
        if (policy.profile_id) layer.profile_id = String(policy.profile_id);
        if (policy.profile_id && profileIdToName.has(String(policy.profile_id))) {
            layer.profile_name = profileIdToName.get(String(policy.profile_id));
        }
        clientMap[String(policy.client_tag)] = layer;
    }

    return {
        profilePolicies: profileMap,
        clientPolicies: clientMap,
        meta: {
            profileCount: Object.keys(profileMap).length,
            clientPolicyCount: Object.keys(clientMap).length,
        },
    };
}
