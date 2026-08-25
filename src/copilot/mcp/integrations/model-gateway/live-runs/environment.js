// @ts-check
/** Environment authority for MCP-launched Model Gateway / LLM-B live operations. */

import { buildMcpChildEnvironment } from '#copilot/mcp/public/process/environment';
import { DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS } from '#copilot/model-gateway';

const READ_ONLY_CONFIG_KEYS = Object.freeze([
    'MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS',
    'MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DISABLED',
    'MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_ENABLED',
    'TERMINAL_BYOK_PROVIDER_HEALTH_PATH',
    'TERMINAL_BYOK_PROVIDER_HEALTH_PERSIST_DISABLED',
]);

const LIVE_COMMON_CONFIG_KEYS = Object.freeze([
    ...READ_ONLY_CONFIG_KEYS,
    'COPILOT_CONSOLE_LOG_LEVEL',
    'COPILOT_LIVE_TEST_COPILOT_MODEL',
    'COPILOT_MODEL_GATEWAY_CONTROL_PLANE_MODEL',
    'COPILOT_TERMINAL_AUTO_BRIEF',
    'COPILOT_TERMINAL_BOOT_MENU',
    'COPILOT_TERMINAL_CONSOLE_LOG_LEVEL',
    'COPILOT_TERMINAL_DETAIL',
    'COPILOT_TERMINAL_DURABLE_TOOL_HEARTBEAT',
    'COPILOT_TERMINAL_DURABLE_WAITING_NARRATION',
    'COPILOT_TERMINAL_INLINE_STATUS',
    'COPILOT_TERMINAL_PICKER_FILTER',
    'COPILOT_TERMINAL_THEME',
    'COPILOT_TERMINAL_TIME_MODE',
    'LLM_B_TERMINAL_PORT_STRICT',
    'TERMINAL_DISPLAY_PRESET',
    'TERMINAL_SSE_EVENT_ARCHIVE_DIR',
    'TERMINAL_SSE_EVENT_ARCHIVE_DISABLED',
    'TERMINAL_TRANSCRIPT_ARCHIVE_DIR',
]);

const REAL_PROVIDER_CONFIG_KEYS = Object.freeze([
    'COPILOT_BYOK_ADMISSION_MODE',
    'COPILOT_BYOK_API_KEY_ENV',
    'COPILOT_BYOK_AZURE_API_VERSION',
    'COPILOT_BYOK_BASE_URL',
    'COPILOT_BYOK_BEARER_TOKEN_ENV',
    'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
    'COPILOT_BYOK_DAILY_REQUESTS',
    'COPILOT_BYOK_ENABLED',
    'COPILOT_BYOK_GATEWAY_AUTO',
    'COPILOT_BYOK_GATEWAY_AUTO_ACCOUNT_WIDE_FAILURE_KINDS',
    'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL',
    'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE',
    'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION',
    'COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES',
    'COPILOT_BYOK_GATEWAY_AUTO_POLICY',
    'COPILOT_BYOK_GATEWAY_AUTO_PRESET',
    'COPILOT_BYOK_GATEWAY_AUTO_PROFILES',
    'COPILOT_BYOK_HEADERS_JSON',
    'COPILOT_BYOK_MAX_REQUEST_TOKENS',
    'COPILOT_BYOK_MODEL',
    'COPILOT_BYOK_MODELS',
    'COPILOT_BYOK_MODELS_ENDPOINT',
    'COPILOT_BYOK_MODELS_JSON',
    'COPILOT_BYOK_MODEL_DISCOVERY_ENABLED',
    'COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS',
    'COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS',
    'COPILOT_BYOK_PROFILE',
    'COPILOT_BYOK_PROFILES_JSON',
    'COPILOT_BYOK_PROVIDER_PRESET',
    'COPILOT_BYOK_PROVIDER_TYPE',
    'COPILOT_BYOK_REQUESTS_PER_MINUTE',
    'COPILOT_BYOK_SUPPORTS_REASONING',
    'COPILOT_BYOK_SUPPORTS_VISION',
    'COPILOT_BYOK_TOKENS_PER_MINUTE',
    'COPILOT_BYOK_WIRE_API',
    'COPILOT_MODEL_GATEWAY_BINDING_SOURCE',
    'COPILOT_MODEL_GATEWAY_PROVIDER_ID',
    'COPILOT_MODEL_GATEWAY_PROVIDER_PROFILE',
    'COPILOT_OLLAMA_BASE_URL',
    'OLLAMA_BASE_URL',
    'OLLAMA_HOST',
    'OLLAMA_LOCAL_BASE_URL',
    'OLLAMA_CLOUD_BASE_URL',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_AI_GATEWAY_ID',
]);

const COPILOT_MODEL_CREDENTIAL_KEYS = Object.freeze([
    'COPILOT_CONNECTION_TOKEN',
    'COPILOT_GITHUB_TOKEN',
    'GITHUB_TOKEN',
]);

/** @param {NodeJS.ProcessEnv} source @param {Record<string, string | null>} target @param {readonly string[]} keys */
function copyConfigured(source, target, keys) {
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined) target[key] = value;
    }
}

/** @param {string | undefined} value */
function validEnvironmentKey(value) {
    const key = String(value ?? '').trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? key : null;
}

/** @param {NodeJS.ProcessEnv} source @param {Record<string, string | null>} target @param {string} pointerKey */
function copyExplicitSecretReference(source, target, pointerKey) {
    const referencedKey = validEnvironmentKey(source[pointerKey]);
    if (!referencedKey) return;
    target[pointerKey] = referencedKey;
    const value = source[referencedKey];
    if (value !== undefined) target[referencedKey] = value;
}

/** @param {NodeJS.ProcessEnv} source @param {Record<string, string | null>} target */
function copyKnownProviderSecrets(source, target) {
    copyConfigured(source, target, DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS);
    const knownRefs = new Set(DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS);
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined) continue;
        const match = /^COPILOT_BYOK_(?:ACCOUNT|WORKSPACE)_[A-Z0-9_]+__([A-Z][A-Z0-9_]*)$/u.exec(key);
        if (match?.[1] && knownRefs.has(match[1])) target[key] = value;
    }
    copyExplicitSecretReference(source, target, 'COPILOT_BYOK_API_KEY_ENV');
    copyExplicitSecretReference(source, target, 'COPILOT_BYOK_BEARER_TOKEN_ENV');
}

/** @param {NodeJS.ProcessEnv} parentEnv */
export function buildModelGatewayReadOnlyChildEnvironment(parentEnv) {
    if (!parentEnv) throw new TypeError('Model Gateway read-only environment projection requires parentEnv.');
    /** @type {Record<string, string | null>} */
    const overrides = {
        MODEL_GATEWAY_LOAD_DOTENV: 'false',
        COPILOT_TERMINAL_LOAD_DOTENV_LOCAL: 'false',
    };
    copyConfigured(parentEnv, overrides, READ_ONLY_CONFIG_KEYS);
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}

/**
 * @param {{ invokesModel?: boolean; invokesRealProvider?: boolean }} plan
 * @param {NodeJS.ProcessEnv} parentEnv
 */
export function buildModelGatewayLiveRunEnvironment(plan, parentEnv) {
    if (!parentEnv) throw new TypeError('Model Gateway live environment projection requires parentEnv.');
    /** @type {Record<string, string | null>} */
    const overrides = {
        MODEL_GATEWAY_LOAD_DOTENV: 'false',
        COPILOT_TERMINAL_LOAD_DOTENV_LOCAL: 'false',
    };
    copyConfigured(parentEnv, overrides, LIVE_COMMON_CONFIG_KEYS);
    if (plan.invokesModel === true) copyConfigured(parentEnv, overrides, COPILOT_MODEL_CREDENTIAL_KEYS);
    if (plan.invokesRealProvider === true) {
        copyConfigured(parentEnv, overrides, REAL_PROVIDER_CONFIG_KEYS);
        copyKnownProviderSecrets(parentEnv, overrides);
    }
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}

export const MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION = 1;
export const MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_KIND = 'copilot-mcp-model-gateway-live-environment-authority';

/**
 * Secret-bearing process capability for Model Gateway live subprocesses.
 *
 * Raw process.env is never retained. The authority closes only over bounded, already-projected child environments and
 * exposes methods rather than secret/config fields, so JSON/string inspection of the capability cannot reveal tokens.
 *
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-model-gateway-live-environment-authority';
 *     readOnlyEnvironment: () => Readonly<NodeJS.ProcessEnv>;
 *     liveRunEnvironment: (plan: { invokesModel?: boolean; invokesRealProvider?: boolean }) => Readonly<NodeJS.ProcessEnv>;
 * }>} ModelGatewayLiveRunEnvironmentAuthority
 */

/** @param {NodeJS.ProcessEnv} [parentEnv] @returns {ModelGatewayLiveRunEnvironmentAuthority} */
export function createModelGatewayLiveRunEnvironmentAuthority(parentEnv = process.env) {
    const templates = Object.freeze({
        readOnly: freezeEnvironment(buildModelGatewayReadOnlyChildEnvironment(parentEnv)),
        control: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: false, invokesRealProvider: false }, parentEnv),
        ),
        model: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: true, invokesRealProvider: false }, parentEnv),
        ),
        provider: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: false, invokesRealProvider: true }, parentEnv),
        ),
        modelAndProvider: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: true, invokesRealProvider: true }, parentEnv),
        ),
    });
    return Object.freeze({
        schemaVersion: MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION,
        kind: MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_KIND,
        readOnlyEnvironment: () => freezeEnvironment(templates.readOnly),
        liveRunEnvironment(plan) {
            const template =
                plan.invokesModel === true
                    ? plan.invokesRealProvider === true
                        ? templates.modelAndProvider
                        : templates.model
                    : plan.invokesRealProvider === true
                      ? templates.provider
                      : templates.control;
            return freezeEnvironment(template);
        },
    });
}

/** @param {Readonly<NodeJS.ProcessEnv>} projectedEnvironment @returns {Readonly<NodeJS.ProcessEnv>} */
function freezeEnvironment(projectedEnvironment) {
    return Object.freeze({ ...projectedEnvironment });
}
