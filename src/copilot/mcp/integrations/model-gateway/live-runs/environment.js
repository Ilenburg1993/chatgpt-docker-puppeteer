// @ts-check
/** Environment authority for MCP-launched Model Gateway / LLM-B live operations. */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { buildMcpChildEnvironment, parseMcpEnvironmentFile } from '#copilot/mcp/public/process/environment';
import { DEFAULT_MODEL_GATEWAY_SECRET_ENV_KEYS } from '#copilot/model-gateway';

const DEFAULT_ENV_FILE = '.env.local';
const MODEL_GATEWAY_ENVIRONMENT_AUTHORITY_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.model-gateway.live-environment-authority',
        exactPaths: [DEFAULT_ENV_FILE],
        operations: ['read'],
        symlinkPolicy: 'deny',
    }),
);

const PROCESS_COMPOSITION_CONFIG_KEYS = Object.freeze(['COPILOT_DB_PATH']);

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

/** @param {NodeJS.ProcessEnv} source @param {Record<string, string | null | undefined>} target @param {readonly string[]} keys */
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

/** @param {NodeJS.ProcessEnv} source @param {Record<string, string | null | undefined>} target @param {string} pointerKey */
function copyExplicitSecretReference(source, target, pointerKey) {
    const referencedKey = validEnvironmentKey(source[pointerKey]);
    if (!referencedKey) return;
    target[pointerKey] = referencedKey;
    const value = source[referencedKey];
    if (value !== undefined) target[referencedKey] = value;
}

/** @param {NodeJS.ProcessEnv} source @param {Record<string, string | null | undefined>} target */
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

/**
 * Project only Model Gateway/BYOK configuration and recognized provider secrets from `.env.local`.
 * Copilot model credentials, MCP credentials and unrelated future secrets are deliberately excluded.
 * Exported only through the testing membrane.
 *
 * @param {Record<string, string>} fileEnv
 * @returns {Readonly<NodeJS.ProcessEnv>}
 */
export function projectModelGatewayAuthorityFileEnvironment(fileEnv) {
    /** @type {Record<string, string | null | undefined>} */
    const projected = {};
    copyConfigured(fileEnv, projected, [
        ...READ_ONLY_CONFIG_KEYS,
        ...LIVE_COMMON_CONFIG_KEYS,
        ...REAL_PROVIDER_CONFIG_KEYS,
    ]);
    copyKnownProviderSecrets(fileEnv, projected);
    return freezeDefinedEnvironment(projected);
}

/** @param {NodeJS.ProcessEnv} parentEnv @returns {Readonly<NodeJS.ProcessEnv>} */
function captureModelGatewayAuthoritySource(parentEnv) {
    const operational = buildMcpChildEnvironment({ parentEnv }).env;
    /** @type {Record<string, string | null | undefined>} */
    const captured = { ...operational };
    copyConfigured(parentEnv, captured, [
        ...PROCESS_COMPOSITION_CONFIG_KEYS,
        ...READ_ONLY_CONFIG_KEYS,
        ...LIVE_COMMON_CONFIG_KEYS,
        ...REAL_PROVIDER_CONFIG_KEYS,
    ]);
    copyConfigured(parentEnv, captured, COPILOT_MODEL_CREDENTIAL_KEYS);
    copyKnownProviderSecrets(parentEnv, captured);
    return freezeDefinedEnvironment(captured);
}

/** @param {NodeJS.ProcessEnv} parentEnv */
export function buildModelGatewayReadOnlyChildEnvironment(parentEnv) {
    if (!parentEnv) throw new TypeError('Model Gateway read-only environment projection requires parentEnv.');
    /** @type {Record<string, string | null>} */
    const overrides = {
        MODEL_GATEWAY_LOAD_DOTENV: 'false',
        COPILOT_TERMINAL_LOAD_DOTENV_LOCAL: 'false',
    };
    copyConfigured(parentEnv, overrides, PROCESS_COMPOSITION_CONFIG_KEYS);
    copyConfigured(parentEnv, overrides, READ_ONLY_CONFIG_KEYS);
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}

/**
 * Build the authority projection for read-only readiness. Readiness may inspect provider configuration and use provider
 * secret values only as local redaction/leak detectors, but it never receives Copilot-model or MCP/OAuth credentials
 * and never gains network authority from this environment alone.
 *
 * @param {NodeJS.ProcessEnv} parentEnv
 */
export function buildModelGatewayReadinessChildEnvironment(parentEnv) {
    if (!parentEnv) throw new TypeError('Model Gateway readiness environment projection requires parentEnv.');
    /** @type {Record<string, string | null>} */
    const overrides = {
        MODEL_GATEWAY_LOAD_DOTENV: 'false',
        COPILOT_TERMINAL_LOAD_DOTENV_LOCAL: 'false',
    };
    copyConfigured(parentEnv, overrides, PROCESS_COMPOSITION_CONFIG_KEYS);
    copyConfigured(parentEnv, overrides, LIVE_COMMON_CONFIG_KEYS);
    copyConfigured(parentEnv, overrides, REAL_PROVIDER_CONFIG_KEYS);
    copyKnownProviderSecrets(parentEnv, overrides);
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
    copyConfigured(parentEnv, overrides, PROCESS_COMPOSITION_CONFIG_KEYS);
    copyConfigured(parentEnv, overrides, LIVE_COMMON_CONFIG_KEYS);
    if (plan.invokesModel === true) copyConfigured(parentEnv, overrides, COPILOT_MODEL_CREDENTIAL_KEYS);
    if (plan.invokesRealProvider === true) {
        copyConfigured(parentEnv, overrides, REAL_PROVIDER_CONFIG_KEYS);
        copyKnownProviderSecrets(parentEnv, overrides);
    }
    return buildMcpChildEnvironment({ parentEnv, overrides }).env;
}

export const MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION = 3;
export const MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_KIND = 'copilot-mcp-model-gateway-live-environment-authority';

/**
 * Secret-bearing process capability for Model Gateway live subprocesses and in-process readiness evaluation.
 *
 * Raw process.env is never retained. The authority captures only bounded Model Gateway/Copilot-model inputs, then may
 * enrich that generation once from the allowlisted `.env.local` projection during process-host prepare. Process values
 * override file values. Methods expose fresh frozen copies and serialization exposes metadata only.
 *
 * @typedef {Readonly<{
 *     schemaVersion: 3;
 *     kind: 'copilot-mcp-model-gateway-live-environment-authority';
 *     prepare: () => Promise<void>;
 *     readOnlyEnvironment: () => Readonly<NodeJS.ProcessEnv>;
 *     readinessEnvironment: () => Readonly<NodeJS.ProcessEnv>;
 *     liveRunEnvironment: (plan: { invokesModel?: boolean; invokesRealProvider?: boolean }) => Readonly<NodeJS.ProcessEnv>;
 *     toJSON: () => Record<string, unknown>;
 * }>} ModelGatewayLiveRunEnvironmentAuthority
 */

/** @param {NodeJS.ProcessEnv} [parentEnv] @returns {ModelGatewayLiveRunEnvironmentAuthority} */
export function createModelGatewayLiveRunEnvironmentAuthority(parentEnv = process.env) {
    return createModelGatewayLiveRunEnvironmentAuthorityWithDependencies(parentEnv, {});
}

/**
 * White-box construction seam for authority lifecycle tests. Production callers use the public factory above.
 *
 * @param {NodeJS.ProcessEnv} parentEnv
 * @param {{ readEnvironmentFile?: () => Promise<string> }} dependencies
 * @returns {ModelGatewayLiveRunEnvironmentAuthority}
 */
export function createModelGatewayLiveRunEnvironmentAuthorityWithDependencies(parentEnv, dependencies) {
    const capturedSource = captureModelGatewayAuthoritySource(parentEnv);
    let templates = buildAuthorityTemplates(capturedSource);
    let prepared = false;
    /** @type {Promise<void> | null} */
    let preparePromise = null;

    /** @type {ModelGatewayLiveRunEnvironmentAuthority} */
    const authority = Object.freeze({
        schemaVersion: MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION,
        kind: MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_KIND,
        async prepare() {
            if (prepared) return;
            if (!preparePromise) {
                preparePromise = (async () => {
                    /** @type {Record<string, string>} */
                    let fileEnv;
                    try {
                        const content = dependencies.readEnvironmentFile
                            ? await dependencies.readEnvironmentFile()
                            : (await MODEL_GATEWAY_ENVIRONMENT_AUTHORITY_IO.readTextFresh(DEFAULT_ENV_FILE)).content;
                        fileEnv = parseMcpEnvironmentFile(content);
                    } catch {
                        fileEnv = {};
                    }
                    const fileProjection = projectModelGatewayAuthorityFileEnvironment(fileEnv);
                    templates = buildAuthorityTemplates(Object.freeze({ ...fileProjection, ...capturedSource }));
                    prepared = true;
                })().finally(() => {
                    preparePromise = null;
                });
            }
            await preparePromise;
        },
        readOnlyEnvironment: () => freezeEnvironment(templates.readOnly),
        readinessEnvironment: () => freezeEnvironment(templates.readiness),
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
        toJSON() {
            return {
                schemaVersion: MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_SCHEMA_VERSION,
                kind: MODEL_GATEWAY_LIVE_ENVIRONMENT_AUTHORITY_KIND,
                prepared,
                credentialsExposed: false,
            };
        },
    });
    return authority;
}

/** @param {Readonly<NodeJS.ProcessEnv>} source */
function buildAuthorityTemplates(source) {
    return Object.freeze({
        readOnly: freezeEnvironment(buildModelGatewayReadOnlyChildEnvironment(source)),
        readiness: freezeEnvironment(buildModelGatewayReadinessChildEnvironment(source)),
        control: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: false, invokesRealProvider: false }, source),
        ),
        model: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: true, invokesRealProvider: false }, source),
        ),
        provider: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: false, invokesRealProvider: true }, source),
        ),
        modelAndProvider: freezeEnvironment(
            buildModelGatewayLiveRunEnvironment({ invokesModel: true, invokesRealProvider: true }, source),
        ),
    });
}

/** @param {Readonly<NodeJS.ProcessEnv>} projectedEnvironment @returns {Readonly<NodeJS.ProcessEnv>} */
function freezeEnvironment(projectedEnvironment) {
    return Object.freeze({ ...projectedEnvironment });
}

/**
 * @param {Record<string, string | null | undefined>} source
 * @returns {Readonly<NodeJS.ProcessEnv>}
 */
function freezeDefinedEnvironment(source) {
    /** @type {NodeJS.ProcessEnv} */
    const normalized = {};
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'string') normalized[key] = value;
    }
    return Object.freeze(normalized);
}
