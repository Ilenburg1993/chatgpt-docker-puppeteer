// @ts-check
/**
 * Runtime automation policy for model-gateway.
 *
 * Defaults are intentionally conservative: status/plan can run any time, but live model switching, new SDK sessions,
 * local private providers and provider execution stay opt-in.
 *
 * @module copilot/model-gateway/automation/policy
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH =
    'data/copilot/model-gateway/runtime-automation-policy.json';

export const MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV = Object.freeze({
    enabled: 'COPILOT_BYOK_GATEWAY_AUTO',
    preset: 'COPILOT_BYOK_GATEWAY_AUTO_PRESET',
    policy: 'COPILOT_BYOK_GATEWAY_AUTO_POLICY',
    profiles: 'COPILOT_BYOK_GATEWAY_AUTO_PROFILES',
    allowLiveSetModel: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL',
    allowNewSession: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION',
    allowProviderProbes: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES',
    allowLocalPrivate: 'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE',
    accountWideFailureKinds: 'COPILOT_BYOK_GATEWAY_AUTO_ACCOUNT_WIDE_FAILURE_KINDS',
});

const MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_FIELDS = Object.freeze([
    'enabled',
    'preset',
    'policy',
    'profiles',
    'allowLiveSetModel',
    'allowNewSession',
    'allowProviderProbes',
    'allowLocalPrivate',
    'accountWideFailureKinds',
]);

const MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_MODES = Object.freeze([
    'metadata_first',
    'prefer_runtime_proved',
    'require_runtime_proof',
]);

export const MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESET_IDS = Object.freeze([
    'operator_manual',
    'llm_operator_guarded',
    'auto_same_boundary',
    'auto_prepare_new_session',
]);

export const MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESETS = Object.freeze({
    operator_manual: Object.freeze({
        preset: 'operator_manual',
        enabled: true,
        policy: 'prefer_runtime_proved',
        profiles: [],
        allowLiveSetModel: false,
        allowNewSession: false,
        allowProviderProbes: false,
        allowLocalPrivate: false,
        accountWideFailureKinds: ['rate-limit', 'quota', 'credits'],
    }),
    llm_operator_guarded: Object.freeze({
        preset: 'llm_operator_guarded',
        enabled: true,
        policy: 'require_runtime_proof',
        profiles: [],
        allowLiveSetModel: false,
        allowNewSession: false,
        allowProviderProbes: false,
        allowLocalPrivate: false,
        accountWideFailureKinds: ['rate-limit', 'quota', 'credits'],
    }),
    auto_same_boundary: Object.freeze({
        preset: 'auto_same_boundary',
        enabled: true,
        policy: 'prefer_runtime_proved',
        profiles: [],
        allowLiveSetModel: true,
        allowNewSession: false,
        allowProviderProbes: false,
        allowLocalPrivate: false,
        accountWideFailureKinds: ['rate-limit', 'quota', 'credits'],
    }),
    auto_prepare_new_session: Object.freeze({
        preset: 'auto_prepare_new_session',
        enabled: true,
        policy: 'prefer_runtime_proved',
        profiles: [],
        allowLiveSetModel: true,
        allowNewSession: true,
        allowProviderProbes: false,
        allowLocalPrivate: false,
        accountWideFailureKinds: ['rate-limit', 'quota', 'credits'],
    }),
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
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalPresetId(value) {
    const preset = optionalString(value);
    return preset ? preset.toLowerCase().replace(/[\s-]+/gu, '_') : null;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function optionalBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return truthy(value);
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function optionalStringList(value) {
    if (Array.isArray(value)) {
        const list = value.map(optionalString).filter((item) => item !== null);
        return list;
    }
    const list = csv(value);
    return list.length > 0 ? list : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {Record<string, unknown>} object
 * @param {string} field
 * @returns {boolean}
 */
function hasOwn(object, field) {
    return Object.prototype.hasOwnProperty.call(object, field);
}

/**
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function normalizePolicyPatch(patch) {
    /** @type {Record<string, unknown>} */
    const normalized = {};
    const enabled = optionalBoolean(patch['enabled']);
    const preset = optionalPresetId(patch['preset']);
    const policy = optionalString(patch['policy']);
    const profiles = optionalStringList(patch['profiles']);
    const allowLiveSetModel = optionalBoolean(patch['allowLiveSetModel']);
    const allowNewSession = optionalBoolean(patch['allowNewSession']);
    const allowProviderProbes = optionalBoolean(patch['allowProviderProbes']);
    const allowLocalPrivate = optionalBoolean(patch['allowLocalPrivate']);
    const accountWideFailureKinds = optionalStringList(patch['accountWideFailureKinds']);
    if (enabled !== null) normalized['enabled'] = enabled;
    if (preset !== null) normalized['preset'] = preset;
    if (policy !== null) normalized['policy'] = policy;
    if (profiles !== null) normalized['profiles'] = profiles;
    if (allowLiveSetModel !== null) normalized['allowLiveSetModel'] = allowLiveSetModel;
    if (allowNewSession !== null) normalized['allowNewSession'] = allowNewSession;
    if (allowProviderProbes !== null) normalized['allowProviderProbes'] = allowProviderProbes;
    if (allowLocalPrivate !== null) normalized['allowLocalPrivate'] = allowLocalPrivate;
    if (accountWideFailureKinds !== null) normalized['accountWideFailureKinds'] = accountWideFailureKinds;
    return normalized;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, unknown>}
 */
function envPolicyPatch(env) {
    /** @type {Record<string, unknown>} */
    const patch = {};
    for (const [field, envName] of Object.entries(MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV)) {
        if (env[envName] === undefined) continue;
        if (field === 'profiles' || field === 'accountWideFailureKinds') {
            patch[field] = csv(env[envName]);
        } else if (field === 'policy' || field === 'preset') {
            patch[field] = env[envName];
        } else {
            patch[field] = truthy(env[envName]);
        }
    }
    return normalizePolicyPatch(patch);
}

/**
 * @param {unknown} presetId
 * @returns {Record<string, unknown> | null}
 */
function policyPresetPatch(presetId) {
    const normalizedPresetId = optionalPresetId(presetId);
    if (!normalizedPresetId) return null;
    return (
        /** @type {Record<string, unknown> | undefined} */ (
            Reflect.get(MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESETS, normalizedPresetId)
        ) ?? null
    );
}

/**
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function expandPolicyPatchPreset(patch) {
    const normalized = normalizePolicyPatch(patch);
    const preset = policyPresetPatch(normalized['preset']);
    return preset ? { ...preset, ...normalized } : normalized;
}

/**
 * @returns {Array<Record<string, unknown>>}
 */
export function listModelGatewayRuntimeAutomationPolicyPresets() {
    return MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESET_IDS.map((presetId) => ({
        .../** @type {Record<string, unknown>} */ (Reflect.get(MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESETS, presetId)),
    }));
}

/**
 * @param {unknown} presetId
 * @param {Record<string, unknown>} [overrides]
 * @returns {ReturnType<typeof readModelGatewayRuntimeAutomationPolicy>}
 */
export function resolveModelGatewayRuntimeAutomationPolicyPreset(presetId, overrides = {}) {
    const normalizedPresetId = optionalPresetId(presetId) ?? 'operator_manual';
    return mergeModelGatewayRuntimeAutomationPolicy({ preset: normalizedPresetId }, { ...overrides, preset: normalizedPresetId });
}

/**
 * @param {...Record<string, unknown>} patches
 * @returns {ReturnType<typeof readModelGatewayRuntimeAutomationPolicy>}
 */
export function mergeModelGatewayRuntimeAutomationPolicy(...patches) {
    return /** @type {ReturnType<typeof readModelGatewayRuntimeAutomationPolicy>} */ ({
        enabled: false,
        preset: 'operator_manual',
        policy: 'prefer_runtime_proved',
        profiles: [],
        allowLiveSetModel: false,
        allowNewSession: false,
        allowProviderProbes: false,
        allowLocalPrivate: false,
        accountWideFailureKinds: [],
        ...patches.map(expandPolicyPatchPreset).reduce((merged, patch) => ({ ...merged, ...patch }), {}),
    });
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{
 *   enabled: boolean;
 *   preset: string;
 *   policy: string;
 *   profiles: string[];
 *   allowLiveSetModel: boolean;
 *   allowNewSession: boolean;
 *   allowProviderProbes: boolean;
 *   allowLocalPrivate: boolean;
 *   accountWideFailureKinds: string[];
 * }}
 */
export function readModelGatewayRuntimeAutomationPolicy(env = process.env) {
    return mergeModelGatewayRuntimeAutomationPolicy(envPolicyPatch(env));
}

/**
 * @param {{ filePath?: string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readModelGatewayRuntimeAutomationPolicyFile(options = {}) {
    const filePath = resolve(options.filePath ?? DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH);
    try {
        return normalizePolicyPatch(record(JSON.parse(await readFile(filePath, 'utf8'))));
    } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return {};
        throw error;
    }
}

/**
 * @param {{ env?: Record<string, string | undefined>; filePath?: string }} [options]
 * @returns {Promise<ReturnType<typeof readModelGatewayRuntimeAutomationPolicy>>}
 */
export async function readModelGatewayRuntimeAutomationEffectivePolicy(options = {}) {
    const fileOptions = typeof options.filePath === 'string' ? { filePath: options.filePath } : {};
    return mergeModelGatewayRuntimeAutomationPolicy(
        await readModelGatewayRuntimeAutomationPolicyFile(fileOptions),
        envPolicyPatch(options.env ?? process.env),
    );
}

/**
 * @param {{ env?: Record<string, string | undefined>; filePolicy?: Record<string, unknown> }} [options]
 * @returns {Record<string, { source: 'default' | 'file' | 'env'; env?: string | null }>}
 */
export function explainModelGatewayRuntimeAutomationPolicySources(options = {}) {
    const filePatch = normalizePolicyPatch(record(options.filePolicy));
    const envPatch = envPolicyPatch(options.env ?? process.env);
    return Object.fromEntries(
        MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_FIELDS.map((field) => {
            const envName = optionalString(Reflect.get(MODEL_GATEWAY_RUNTIME_AUTOMATION_ENV, field));
            if (hasOwn(envPatch, field)) {
                return [field, { source: 'env', env: envName }];
            }
            if (hasOwn(filePatch, field)) return [field, { source: 'file', env: envName }];
            return [field, { source: 'default', env: envName }];
        }),
    );
}

/**
 * @param {Record<string, unknown>} policy
 * @returns {{ ok: boolean; issues: string[]; allowedModes: string[]; allowedPresets: string[] }}
 */
export function validateModelGatewayRuntimeAutomationPolicy(policy) {
    const normalized = mergeModelGatewayRuntimeAutomationPolicy(policy);
    const issues = [];
    if (!MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESET_IDS.includes(normalized.preset)) {
        issues.push(`invalid_policy_preset:${normalized.preset}`);
    }
    if (!MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_MODES.includes(normalized.policy)) {
        issues.push(`invalid_policy_mode:${normalized.policy}`);
    }
    if (!Array.isArray(normalized.profiles) || normalized.profiles.some((profile) => optionalString(profile) === null)) {
        issues.push('invalid_profiles');
    }
    if (
        !Array.isArray(normalized.accountWideFailureKinds) ||
        normalized.accountWideFailureKinds.some((failureKind) => optionalString(failureKind) === null)
    ) {
        issues.push('invalid_account_wide_failure_kinds');
    }
    return {
        ok: issues.length === 0,
        issues,
        allowedModes: [...MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_MODES],
        allowedPresets: [...MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PRESET_IDS],
    };
}

/**
 * @param {Record<string, unknown>} policy
 * @param {{ filePath?: string }} [options]
 * @returns {Promise<{ filePath: string; policy: ReturnType<typeof readModelGatewayRuntimeAutomationPolicy> }>}
 */
export async function writeModelGatewayRuntimeAutomationPolicyFile(policy, options = {}) {
    const filePath = resolve(options.filePath ?? DEFAULT_MODEL_GATEWAY_RUNTIME_AUTOMATION_POLICY_PATH);
    const normalized = mergeModelGatewayRuntimeAutomationPolicy(policy);
    const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, filePath);
    return { filePath, policy: normalized };
}
