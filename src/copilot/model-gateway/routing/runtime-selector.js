// @ts-check
/**
 * Final runtime selector planning and bounded execution helpers.
 *
 * This layer turns a resolved selection policy or persisted decision trace into the exact route a runtime caller should
 * attempt first. Planning remains non-executing; the execution helpers below are explicit runtime bridges that record
 * sanitized health and route-decision outcomes without moving provider payloads into canonical metadata.
 */

import { resolveModelGatewayAccountResetWindow } from '../account-access/reset-windows.js';
import { classifyByokProviderFailure } from '../health/provider-failure.js';
import {
    flushByokProviderHealth,
    recordByokProviderModelCallFailure,
    recordByokProviderModelCallSuccess,
} from '../health/provider-health.js';
import { buildRouteDecisionEvent } from '../observability/events.js';
import { recordModelGatewayRouteDecision } from '../observability/route-decision-ledger.js';
import {
    classifyConfiguredByokProbeFailureScope,
    didConfiguredByokProbeAttemptProvider,
    runConfiguredByokChatProbe,
} from '../probes/index.js';
import { resolveProviderEndpointInventory } from '../providers/endpoints/index.js';
import {
    evaluateModelGatewayProviderEnvRequirements,
    resolveModelGatewayProviderSecretRefs,
} from '../secrets/requirements.js';
import {
    createGatewayRuntimeHealthIndex,
    evaluateGatewayModelHealthRoute,
    evaluateGatewayProviderHealthCooldown,
    isGatewayModelProbeActivelyFailed,
} from './health-routing.js';

const DEFAULT_MAX_RUNTIME_RETRY_DELAY_MS = 30_000;

/**
 * @typedef {object} RuntimeSelectorProbeResult
 * @property {boolean} ok
 * @property {string} status
 * @property {boolean} [providerAttempted]
 * @property {string[]} errors
 * @property {string[]} [warnings]
 * @property {ReturnType<typeof classifyByokProviderFailure> | null} [providerFailure]
 * @property {number} [elapsedMs]
 * @property {string | null} [model]
 * @property {string | null} [profile]
 * @property {string | null} [preset]
 * @property {string | null} [providerType]
 */

/**
 * @typedef {object} RuntimeSelectorProbeOptions
 * @property {Record<string, string | undefined>} [env]
 * @property {string | null} [model]
 * @property {number} [timeoutMs]
 * @property {string} [prompt]
 * @property {{ classifyProviderFailure?: typeof classifyByokProviderFailure }} [deps]
 */

/** @typedef {(options?: RuntimeSelectorProbeOptions) => Promise<RuntimeSelectorProbeResult>} RuntimeSelectorProbeRunner */

/**
 * Minimal selected-route contract consumed by the execution layer. Planning may attach richer metadata, but execution
 * must not depend on the planner's complete internal representation.
 *
 * @typedef {Record<string, unknown> & {
 *     id?: string;
 *     providerId?: string;
 *     providerModel?: string;
 *     routeProfile?: string | null;
 *     selectorSyntax?: string;
 *     score?: number | null;
 *     scoreBreakdown?: Record<string, unknown> | null;
 *     reasons?: string[];
 *     hasRuntimeProof?: boolean;
 * }} RuntimeSelectorExecutionSelected
 */

/**
 * @typedef {object} RuntimeSelectorExecutionRoute
 * @property {string} profileId
 * @property {'selected' | 'blocked'} status
 * @property {RuntimeSelectorExecutionSelected | null} selected
 * @property {string | null} selectedRouteKey
 * @property {boolean} hasRuntimeProof
 * @property {RuntimeSelectorExecutionRoute[]} candidateAlternatives
 * @property {string[]} reasons
 * @property {ReturnType<typeof buildRouteDecisionEvent>} decisionEvent
 */

/**
 * @typedef {object} RuntimeSelectorExecutionPlan
 * @property {string} mode
 * @property {RuntimeSelectorExecutionRoute[]} routes
 */

const RUNTIME_ROUTE_ENV_RESET_KEYS = Object.freeze([
    'COPILOT_MODEL_GATEWAY_BINDING_SOURCE',
    'COPILOT_MODEL_GATEWAY_PROVIDER_ID',
    'COPILOT_MODEL_GATEWAY_PROVIDER_PROFILE',
    'COPILOT_BYOK_PROFILE',
    'COPILOT_BYOK_PROVIDER_PRESET',
    'COPILOT_BYOK_PROVIDER_TYPE',
    'COPILOT_BYOK_BASE_URL',
    'COPILOT_BYOK_WIRE_API',
    'COPILOT_BYOK_AZURE_API_VERSION',
    'COPILOT_BYOK_HEADERS_JSON',
    'COPILOT_BYOK_MODEL',
    'COPILOT_BYOK_MODELS',
    'COPILOT_BYOK_MODELS_JSON',
    'COPILOT_BYOK_MODELS_ENDPOINT',
    'COPILOT_BYOK_MODEL_DISCOVERY_ENABLED',
    'COPILOT_BYOK_MODEL_DISCOVERY_TIMEOUT_MS',
    'COPILOT_BYOK_MODEL_DISCOVERY_TTL_MS',
    'COPILOT_BYOK_CONTEXT_WINDOW_TOKENS',
    'COPILOT_BYOK_MAX_REQUEST_TOKENS',
    'COPILOT_BYOK_TOKENS_PER_MINUTE',
    'COPILOT_BYOK_REQUESTS_PER_MINUTE',
    'COPILOT_BYOK_DAILY_REQUESTS',
    'COPILOT_BYOK_SUPPORTS_REASONING',
    'COPILOT_BYOK_SUPPORTS_VISION',
    'COPILOT_BYOK_API_KEY',
    'COPILOT_BYOK_BEARER_TOKEN',
]);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function optionalRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    return Array.isArray(value) ? value.map(optionalString).filter((item) => item !== null) : [];
}

/**
 * @param {(string[] | null | undefined)[]} lists
 * @param {number} limit
 * @returns {string[]}
 */
function uniqueStringList(lists, limit) {
    const seen = new Set();
    const result = [];
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            const value = optionalString(item);
            if (!value || seen.has(value)) continue;
            seen.add(value);
            result.push(value);
            if (result.length >= limit) return result;
        }
    }
    return result;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function optionalBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @param {string} field
 * @returns {string | null}
 */
function routeMetadataString(selected, field) {
    const record = optionalRecord(selected);
    const routing = optionalRecord(record?.['routing']);
    const policy = optionalRecord(record?.['normalizedPolicy']);
    const routeProviderSpecific = optionalRecord(record?.['routeProviderSpecific']);
    const providerSpecific = optionalRecord(record?.['providerSpecific']);
    return (
        optionalString(record?.[field]) ??
        optionalString(routing?.[field]) ??
        optionalString(policy?.[field]) ??
        optionalString(routeProviderSpecific?.[field]) ??
        optionalString(providerSpecific?.[field])
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @param {string} field
 * @returns {boolean | null}
 */
function routeMetadataBoolean(selected, field) {
    const record = optionalRecord(selected);
    const routing = optionalRecord(record?.['routing']);
    const policy = optionalRecord(record?.['normalizedPolicy']);
    const routeProviderSpecific = optionalRecord(record?.['routeProviderSpecific']);
    const providerSpecific = optionalRecord(record?.['providerSpecific']);
    const capabilities = optionalRecord(record?.['capabilities']);
    return (
        optionalBoolean(record?.[field]) ??
        optionalBoolean(routing?.[field]) ??
        optionalBoolean(policy?.[field]) ??
        optionalBoolean(routeProviderSpecific?.[field]) ??
        optionalBoolean(providerSpecific?.[field]) ??
        optionalBoolean(capabilities?.[field])
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @param {string} field
 * @returns {number | null}
 */
function routeMetadataNumber(selected, field) {
    const record = optionalRecord(selected);
    const routing = optionalRecord(record?.['routing']);
    const policy = optionalRecord(record?.['normalizedPolicy']);
    const routeProviderSpecific = optionalRecord(record?.['routeProviderSpecific']);
    const providerSpecific = optionalRecord(record?.['providerSpecific']);
    const capabilities = optionalRecord(record?.['capabilities']);
    const limits = optionalRecord(record?.['limits']);
    return (
        optionalNumber(record?.[field]) ??
        optionalNumber(routing?.[field]) ??
        optionalNumber(policy?.[field]) ??
        optionalNumber(routeProviderSpecific?.[field]) ??
        optionalNumber(providerSpecific?.[field]) ??
        optionalNumber(capabilities?.[field]) ??
        optionalNumber(limits?.[field])
    );
}

/**
 * @param {string | null} wireApi
 * @returns {'completions' | 'responses' | null}
 */
function sdkWireApiForRoute(wireApi) {
    if (wireApi === 'openai_chat_completions' || wireApi === 'chat_completions') return 'completions';
    if (wireApi === 'openai_responses' || wireApi === 'responses') return 'responses';
    if (wireApi === 'completions') return 'completions';
    return null;
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @returns {'completions' | 'responses' | null}
 */
function routeSdkWireApi(selected) {
    const explicit = sdkWireApiForRoute(routeMetadataString(selected, 'wireApi'));
    if (explicit) return explicit;
    const routeLayer = routeMetadataString(selected, 'routeLayer');
    const baseUrl =
        routeMetadataString(selected, 'openAICompatibleBaseUrl') ?? routeMetadataString(selected, 'baseUrl');
    if (baseUrl && routeLayer && routeLayer.includes('openai_compatible')) return 'completions';
    return null;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} refs
 * @returns {string | null}
 */
function firstConfiguredEnvValue(env, refs) {
    for (const ref of refs) {
        const value = optionalString(env[ref]);
        if (value) return value;
    }
    return null;
}

/**
 * @param {string} providerId
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
function resolveRuntimeRouteBaseUrl(providerId, selected, env) {
    const explicit =
        routeMetadataString(selected, 'openAICompatibleBaseUrl') ?? routeMetadataString(selected, 'baseUrl');
    if (explicit) return explicit;
    if (providerId === 'ollama-local' || providerId === 'ollama') {
        const configured = optionalString(env['OLLAMA_LOCAL_BASE_URL']) ?? optionalString(env['OLLAMA_BASE_URL']);
        return configured
            ? `${configured.replace(/\/+$/u, '').replace(/\/api$/u, '')}/v1`
            : 'http://localhost:11434/v1';
    }
    if (providerId === 'ollama-cloud') {
        const configured = optionalString(env['OLLAMA_CLOUD_BASE_URL']);
        return configured ? `${configured.replace(/\/+$/u, '').replace(/\/api$/u, '')}/v1` : 'https://ollama.com/v1';
    }
    const inventory = resolveProviderEndpointInventory(providerId);
    const candidate = inventory?.baseUrls.find((url) => !url.includes('{')) ?? null;
    if (candidate) return candidate;
    if (providerId === 'cloudflare-workers-ai') {
        const accountId = optionalString(env['CLOUDFLARE_ACCOUNT_ID']);
        return accountId ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1` : null;
    }
    return null;
}

/**
 * @param {string} providerId
 * @returns {'openai' | 'azure' | 'anthropic'}
 */
function resolveRuntimeRouteProviderType(providerId) {
    if (providerId === 'anthropic' || providerId === 'claude') return 'anthropic';
    if (providerId === 'azure' || providerId === 'azure-openai') return 'azure';
    return 'openai';
}

/**
 * @param {number} delayMs
 * @returns {Promise<void>}
 */
function sleepMs(delayMs) {
    if (!Number.isFinite(delayMs) || delayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        setTimeout(resolve, Math.round(delayMs));
    });
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function dateMs(value) {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

/**
 * @param {number | null} retryAfterSeconds
 * @param {string | null} resetAt
 * @param {number} nowMs
 * @param {number} fallbackDelayMs
 * @returns {number}
 */
function resolveRuntimeRetryDelayMs(retryAfterSeconds, resetAt, nowMs, fallbackDelayMs) {
    if (retryAfterSeconds !== null && retryAfterSeconds > 0) return Math.ceil(retryAfterSeconds * 1000);
    const resetMs = dateMs(resetAt);
    if (resetMs !== null && resetMs > nowMs) return Math.ceil(resetMs - nowMs);
    return Math.max(0, Math.round(fallbackDelayMs));
}

/**
 * @param {Record<string, unknown> | null} route
 * @returns {string | null}
 */
function routeKey(route) {
    if (!route) return null;
    const providerId = optionalString(route['providerId']);
    const providerModel = optionalString(route['providerModel']);
    if (!providerId || !providerModel) return null;
    return `${providerId}:${providerModel}`;
}

/**
 * @template {object} TRoute
 * @param {TRoute | null} route
 * @param {boolean} hasRuntimeProof
 */
function routeWithRuntimeProofFlag(route, hasRuntimeProof) {
    if (!route) return null;
    return { ...route, hasRuntimeProof };
}

/**
 * @template {object} TRoute
 * @param {TRoute | null} route
 * @param {string} profileId
 */
function routeWithRuntimeProfile(route, profileId) {
    if (!route) return null;
    const record = optionalRecord(route);
    const routeProfile = optionalString(record?.['routeProfile']);
    const taskProfile = optionalString(record?.['taskProfile']);
    return {
        ...route,
        routeProfile: profileId,
        taskProfile: profileId,
        sourceRouteProfile: routeProfile && routeProfile !== profileId ? routeProfile : null,
        sourceTaskProfile: taskProfile && taskProfile !== profileId ? taskProfile : null,
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {string | null}
 */
function runtimeSelectorAttemptKey(route) {
    const selected = optionalRecord(route?.['selected']);
    return optionalString(route?.['selectedRouteKey']) ?? routeKey(selected);
}

/**
 * @param {Record<string, unknown> | null | undefined} route
 * @returns {boolean}
 */
function runtimeSelectorRouteHasProof(route) {
    const selected = optionalRecord(route?.['selected']);
    return route?.['hasRuntimeProof'] === true || selected?.['hasRuntimeProof'] === true;
}

/**
 * @param {string[]} profileIds
 * @param {Map<string, RuntimeSelectorExecutionRoute>} routeByProfileId
 * @param {boolean} preferRuntimeProof
 * @returns {string[]}
 */
function orderRuntimeSelectorAttemptProfileIds(profileIds, routeByProfileId, preferRuntimeProof) {
    if (!preferRuntimeProof) return profileIds;
    return profileIds
        .map((profileId, index) => ({
            profileId,
            index,
            hasRuntimeProof: runtimeSelectorRouteHasProof(routeByProfileId.get(profileId)),
        }))
        .sort((left, right) => Number(right.hasRuntimeProof) - Number(left.hasRuntimeProof) || left.index - right.index)
        .map((entry) => entry.profileId);
}

/**
 * @param {string} profileId
 * @param {{ requireAgentProbeProfiles?: string[] }} [options]
 * @returns {boolean}
 */
function runtimeSelectorProfileRequiresAgentProbe(profileId, options = {}) {
    if (Array.isArray(options.requireAgentProbeProfiles)) {
        return options.requireAgentProbeProfiles
            .map(optionalString)
            .filter((item) => item !== null)
            .includes(profileId);
    }
    return profileId === 'repo_agent' || profileId === 'tool_agent';
}

/**
 * Build the environment for a Model Gateway control-plane host that must stay on the native Copilot SDK while still
 * retaining provider credentials for disposable BYOK probes.
 *
 * Active route/model/base-url materialization is removed. Generic BYOK credentials are restored only as dormant probe
 * inputs; `COPILOT_BYOK_ENABLED=false` prevents them from becoming the controller session binding.
 *
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {Record<string, string | undefined>}
 */
export function buildModelGatewayControlPlaneHostEnv(baseEnv = process.env) {
    const env = { ...baseEnv };
    const genericApiKey = baseEnv['COPILOT_BYOK_API_KEY'];
    const genericBearerToken = baseEnv['COPILOT_BYOK_BEARER_TOKEN'];
    for (const key of RUNTIME_ROUTE_ENV_RESET_KEYS) delete env[key];
    if (genericApiKey) env['COPILOT_BYOK_API_KEY'] = genericApiKey;
    if (genericBearerToken) env['COPILOT_BYOK_BEARER_TOKEN'] = genericBearerToken;
    env['COPILOT_BYOK_ENABLED'] = 'false';
    env['COPILOT_TERMINAL_LOAD_DOTENV_LOCAL'] = 'false';
    return env;
}

/**
 * Build an isolated BYOK env for the selected runtime route.
 *
 * The configured terminal BYOK provider is often just the operator's current default. Runtime selection needs to test
 * the selected route itself, so provider/model/baseUrl/auth overrides from that current default must not leak into a
 * route for a different provider.
 *
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {Record<string, string | undefined>}
 */
export function buildModelGatewayRuntimeSelectorProbeEnv(selected, baseEnv = process.env) {
    const env = { ...baseEnv };
    for (const key of RUNTIME_ROUTE_ENV_RESET_KEYS) delete env[key];
    const providerId = optionalString(selected?.['providerId']);
    const providerModel = optionalString(selected?.['providerModel']);
    const providerProfile = optionalString(selected?.['providerProfile']);
    const baseUrl =
        routeMetadataString(selected, 'openAICompatibleBaseUrl') ?? routeMetadataString(selected, 'baseUrl');
    const sdkWireApi = routeSdkWireApi(selected);
    if (providerId === 'github-copilot-sdk') {
        env['COPILOT_BYOK_ENABLED'] = 'false';
        if (providerModel) env['COPILOT_BYOK_MODEL'] = providerModel;
        return env;
    }
    env['COPILOT_BYOK_ENABLED'] = 'true';
    if (providerId) {
        env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'] = 'gateway_route';
        env['COPILOT_MODEL_GATEWAY_PROVIDER_ID'] = providerId;
        env['COPILOT_BYOK_PROVIDER_PRESET'] = 'custom';
        env['COPILOT_BYOK_PROVIDER_TYPE'] = resolveRuntimeRouteProviderType(providerId);
        const routeBaseUrl = resolveRuntimeRouteBaseUrl(providerId, selected, baseEnv);
        if (routeBaseUrl) env['COPILOT_BYOK_BASE_URL'] = routeBaseUrl;
        const secretRefs = resolveModelGatewayProviderSecretRefs(providerId);
        const routeBearerTokenRefs = secretRefs.bearerTokenRefs.filter((ref) => ref !== 'COPILOT_BYOK_BEARER_TOKEN');
        const routeApiKeyRefs = secretRefs.apiKeyRefs.filter((ref) => ref !== 'COPILOT_BYOK_API_KEY');
        const bearerToken = firstConfiguredEnvValue(baseEnv, [...routeBearerTokenRefs, 'COPILOT_BYOK_BEARER_TOKEN']);
        const apiKey = firstConfiguredEnvValue(baseEnv, [...routeApiKeyRefs, 'COPILOT_BYOK_API_KEY']);
        if (bearerToken) env['COPILOT_BYOK_BEARER_TOKEN'] = bearerToken;
        else if (apiKey) env['COPILOT_BYOK_API_KEY'] = apiKey;
    }
    if (providerProfile) env['COPILOT_BYOK_PROFILE'] = providerProfile;
    if (providerModel) env['COPILOT_BYOK_MODEL'] = providerModel;
    if (baseUrl) env['COPILOT_BYOK_BASE_URL'] = baseUrl;
    if (sdkWireApi) env['COPILOT_BYOK_WIRE_API'] = sdkWireApi;
    const supportsReasoning =
        routeMetadataBoolean(selected, 'reasoningEffort') ?? routeMetadataBoolean(selected, 'supportsReasoning');
    const supportsVision = routeMetadataBoolean(selected, 'vision') ?? routeMetadataBoolean(selected, 'supportsVision');
    const contextWindowTokens =
        routeMetadataNumber(selected, 'contextWindowTokens') ??
        routeMetadataNumber(selected, 'maxContextWindowTokens') ??
        routeMetadataNumber(selected, 'max_context_window_tokens');
    if (supportsReasoning !== null) env['COPILOT_BYOK_SUPPORTS_REASONING'] = String(supportsReasoning);
    if (supportsVision !== null) env['COPILOT_BYOK_SUPPORTS_VISION'] = String(supportsVision);
    if (contextWindowTokens !== null && contextWindowTokens > 0) {
        env['COPILOT_BYOK_CONTEXT_WINDOW_TOKENS'] = String(Math.floor(contextWindowTokens));
    }
    return env;
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {{
 *     providerId: string | null;
 *     providerModel: string | null;
 *     providerPreset: string | null;
 *     model: string | null;
 *     status: 'ready' | 'missing' | 'partial';
 *     configuredKeys: string[];
 *     missingRequiredKeys: string[];
 *     missingRecommendedKeys: string[];
 * }}
 */
export function evaluateModelGatewayRuntimeSelectorRouteEnv(selected, baseEnv = process.env) {
    const env = buildModelGatewayRuntimeSelectorProbeEnv(selected, baseEnv);
    const providerId = optionalString(selected?.['providerId']);
    const requirement = providerId ? evaluateModelGatewayProviderEnvRequirements({ env, providerId })[0] : null;
    return {
        providerId,
        providerModel: optionalString(selected?.['providerModel']),
        providerPreset: optionalString(env['COPILOT_BYOK_PROVIDER_PRESET']),
        model: optionalString(env['COPILOT_BYOK_MODEL']),
        status: requirement?.status ?? 'missing',
        configuredKeys: requirement?.configuredKeys ?? [],
        missingRequiredKeys: requirement?.missingRequiredKeys ?? [],
        missingRecommendedKeys: requirement?.missingRecommendedKeys ?? [],
    };
}

/**
 * @param {unknown} value
 */
function normalizeRuntimeRouteEvidence(value) {
    const record = optionalRecord(value);
    if (!record) return null;
    return {
        ...record,
        source: optionalString(record['source']),
        routeProfile: optionalString(record['routeProfile']),
        runtimeHealthStatus: optionalString(record['runtimeHealthStatus']),
        lastStatus: optionalString(record['lastStatus']),
        agentProbeStatus: optionalString(record['agentProbeStatus']),
        verifiedProbes: stringList(record['verifiedProbes']),
    };
}

/**
 * @param {unknown} value
 */
function normalizeRuntimeRouteScoreBreakdown(value) {
    const record = optionalRecord(value);
    if (!record) return null;
    return {
        baseScore: optionalNumber(record['baseScore']),
        finalScore: optionalNumber(record['finalScore']),
        delta: optionalNumber(record['delta']),
        hardGateCount: optionalNumber(record['hardGateCount']),
        positiveSignals: stringList(record['positiveSignals']),
        negativeSignals: stringList(record['negativeSignals']),
        groups: optionalRecord(record['groups']) ?? {},
        rejectedGroups: optionalRecord(record['rejectedGroups']) ?? {},
    };
}

/**
 * @param {unknown} value
 */
function normalizeRuntimeRouteAccountAccess(value) {
    const record = optionalRecord(value);
    if (!record) return null;
    return {
        status: optionalString(record['status']),
        canAttempt: record['canAttempt'] === true,
        secretRef: optionalString(record['secretRef']),
        secretConfigured: optionalBoolean(record['secretConfigured']),
        modelVisible: record['modelVisible'] === true,
        modelIdentifiers: stringList(record['modelIdentifiers']),
        accessConfidence: optionalString(record['accessConfidence']),
        failureClass: optionalString(record['failureClass']),
        overlayRefs: stringList(record['overlayRefs']),
        resetWindows: Array.isArray(record['resetWindows'])
            ? record['resetWindows'].map(optionalRecord).filter((item) => item !== null)
            : [],
        hardReasons: stringList(record['hardReasons']),
        softReasons: stringList(record['softReasons']),
        reasons: stringList(record['reasons']),
    };
}

/**
 * @param {unknown} value
 */
function normalizeRuntimeRouteHealth(value) {
    const record = optionalRecord(value);
    if (!record) return null;
    return {
        ...record,
        lastStatus: optionalString(record['lastStatus']),
        agentProbeStatus: optionalString(record['agentProbeStatus']),
        verifiedProbes: stringList(record['verifiedProbes']),
    };
}

/**
 * @param {Record<string, unknown> | null} route
 */
function runtimeRoute(route) {
    if (!route) return null;
    const providerId = optionalString(route['providerId']);
    const providerModel = optionalString(route['providerModel']);
    if (!providerId || !providerModel) return null;
    const runtimeEvidence = normalizeRuntimeRouteEvidence(route['runtimeEvidence']);
    return {
        id: `${providerId}:${providerModel}`,
        providerId,
        providerModel,
        selectorSyntax: optionalString(route['selectorSyntax']) ?? providerModel,
        routeCandidateId: optionalString(route['routeCandidateId']),
        canonicalModelId: optionalString(route['canonicalModelId']),
        routeProfile: optionalString(route['routeProfile']),
        routeOptionRef: optionalString(route['routeOptionRef']),
        routeOptionRefs: Array.isArray(route['routeOptionRefs'])
            ? route['routeOptionRefs']
                  .map(optionalString)
                  .filter((item) => item !== null)
                  .slice(0, 8)
            : [],
        selectorKind: optionalString(route['selectorKind']),
        routeLayer: routeMetadataString(route, 'routeLayer'),
        wireApi: routeMetadataString(route, 'wireApi'),
        runtimeKind: routeMetadataString(route, 'runtimeKind'),
        upstreamProvider: routeMetadataString(route, 'upstreamProvider'),
        baseUrl: routeMetadataString(route, 'baseUrl'),
        openAICompatibleBaseUrl: routeMetadataString(route, 'openAICompatibleBaseUrl'),
        endpoint: routeMetadataString(route, 'endpoint'),
        aiSdkPackage: routeMetadataString(route, 'aiSdkPackage'),
        autoSelection: routeMetadataBoolean(route, 'autoSelection'),
        supportsFallback: routeMetadataBoolean(route, 'supportsFallback'),
        localPrivate: routeMetadataBoolean(route, 'localPrivate'),
        candidateSource: optionalString(route['candidateSource']),
        runtimeObservedOnly: route['runtimeObservedOnly'] === true || runtimeEvidence?.['source'] === 'runtime_health',
        runtimeEvidence,
        score: optionalNumber(route['score']),
        scoreBreakdown: normalizeRuntimeRouteScoreBreakdown(route['scoreBreakdown']),
        reasons: stringList(route['reasons']).slice(0, 24),
        rejectedReasons: stringList(route['rejectedReasons']).slice(0, 24),
        eligibilityDisposition: optionalString(route['eligibilityDisposition']),
        accountScope: optionalString(route['accountScope']) ?? 'default',
        policyProfile: optionalString(route['policyProfile']),
        taskProfile: optionalString(route['taskProfile']),
        accountAccess: normalizeRuntimeRouteAccountAccess(route['accountAccess']),
        hasRuntimeProof: route['hasRuntimeProof'] === true,
        runtimeHealth: normalizeRuntimeRouteHealth(route['runtimeHealth']),
    };
}

/**
 * @param {ReturnType<typeof runtimeRoute>} route
 * @returns {boolean}
 */
function routeAccountCanAttempt(route) {
    if (!route) return false;
    return route.accountAccess?.canAttempt !== false;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown> | null}
 */
function selectedFromPolicyRow(row) {
    return optionalRecord(row['selected']);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ label: string; selected: Record<string, unknown> }[]}
 */
function selectedCandidatesFromPolicyRow(row) {
    const candidates = [
        { label: 'selected', selected: optionalRecord(row['selected']) },
        { label: 'postSelected', selected: optionalRecord(row['postSelected']) },
        { label: 'preSelected', selected: optionalRecord(row['preSelected']) },
        ...(Array.isArray(row['candidateAlternates'])
            ? row['candidateAlternates'].map((selected, index) => ({
                  label: `alternate${index + 1}`,
                  selected: optionalRecord(selected),
              }))
            : []),
    ];
    const seen = new Set();
    const result = [];
    for (const candidate of candidates) {
        if (!candidate.selected) continue;
        const route = runtimeRoute(candidate.selected);
        const key = routeKey(route);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({ label: candidate.label, selected: candidate.selected });
    }
    return result;
}

/**
 * @param {Record<string, unknown>} input
 * @returns {{ mode: string; rows: Record<string, unknown>[]; sourceSchema: string | null; traceId: string | null }}
 */
function readRowsFromInput(input) {
    const traceRows = Array.isArray(input['rows']) && input['schema'] === 'model-gateway-selection-decision-trace';
    const policy = optionalRecord(input['policy']);
    return {
        mode: optionalString(input['mode']) ?? optionalString(policy?.['mode']) ?? 'metadata_first',
        rows: Array.isArray(input['rows']) ? input['rows'].map((row) => optionalRecord(row) ?? {}) : [],
        sourceSchema: optionalString(input['schema']),
        traceId: traceRows ? optionalString(input['traceId']) : null,
    };
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, unknown>} row
 * @returns {string[]}
 */
function selectionReasons(selected, row) {
    const reasons = [`selection_source:${optionalString(row['source']) ?? 'unknown'}`];
    const proofPresent = selected ? selected['hasRuntimeProof'] === true : row['hasRuntimeProof'] === true;
    reasons.push(proofPresent ? 'runtime_proof:present' : 'runtime_proof:absent');
    if (row['changedFromPreRuntime'] === true) reasons.push('changed_from_pre_runtime');
    return reasons;
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, unknown> | null} row
 * @param {string[]} [extraReasons]
 * @returns {string[]}
 */
function routeDecisionReasons(selected, row, extraReasons = []) {
    return uniqueStringList(
        [stringList(selected?.['reasons']), row ? selectionReasons(selected, row) : [], extraReasons],
        32,
    );
}

/**
 * @param {Record<string, unknown> | null} selected
 * @param {Record<string, unknown>} row
 * @param {{ sessionId?: string | null; source?: string; mode?: string }} options
 * @returns {ReturnType<typeof buildRouteDecisionEvent>}
 */
function buildSelectorDecisionEvent(selected, row, options) {
    const route = runtimeRoute(selected);
    return buildRouteDecisionEvent({
        taskProfile: optionalString(row['profileId']) ?? 'unknown',
        routeProfile: optionalString(route?.['routeProfile']) ?? optionalString(row['profileId']),
        mode: options.mode ?? 'metadata_first',
        source: options.source ?? 'model-gateway-runtime-selector',
        sessionId: options.sessionId ?? null,
        route: {
            selected: route
                ? {
                      score: optionalNumber(route['score']),
                      scoreBreakdown: optionalRecord(route['scoreBreakdown']),
                      reasons: routeDecisionReasons(route, row),
                      model: {
                          id: route['id'],
                          providerId: route['providerId'],
                          providerModel: route['providerModel'],
                      },
                  }
                : null,
            candidates: route ? [route] : [],
            rejected: route ? [] : [{ reason: 'runtime_selector_unselected' }],
            fallbackChain: routeKey(selected) ? [String(routeKey(selected))] : [],
        },
        failure: route ? null : 'runtime_selector_unselected',
    });
}

/**
 * @param {Record<string, unknown>} candidate
 * @returns {string[]}
 */
function candidateBlockReasons(candidate) {
    const reasons = [];
    if (!candidate['selected']) reasons.push('no_selected_route');
    if (candidate['accountAccessBlocked'] === true) reasons.push('account_access_denies_attempt');
    if (candidate['runtimeProofBlocked'] === true) reasons.push('runtime_proof_required');
    if (candidate['runtimeEnvBlocked'] === true) reasons.push('runtime_env_not_ready');
    const runtimeHealth = optionalRecord(candidate['runtimeHealth']);
    if (candidate['runtimeHealthBlocked'] === true)
        reasons.push(`runtime_health:${optionalString(runtimeHealth?.['reason']) ?? 'failed'}`);
    const providerCooldown = optionalRecord(candidate['providerCooldown']);
    if (candidate['providerCooldownBlocked'] === true) {
        const failureKinds = Array.isArray(providerCooldown?.['failureKinds'])
            ? providerCooldown['failureKinds'].map(optionalString).filter((item) => item !== null)
            : [];
        reasons.push(`provider_health_cooldown:${failureKinds.join('+') || 'temporary'}`);
    }
    const failedProbeKinds = Array.isArray(candidate['failedProbeKinds'])
        ? candidate['failedProbeKinds'].map(optionalString).filter((item) => item !== null)
        : [];
    for (const kind of failedProbeKinds) reasons.push(`runtime_probe_failed:${kind}`);
    return reasons;
}

/**
 * @param {Record<string, unknown>[]} candidateEvaluations
 * @returns {{
 *     evaluatedCount: number;
 *     usableCount: number;
 *     blockedCount: number;
 *     providerCount: number;
 *     rejectionReasonCounts: Record<string, number>;
 *     topBlockedRoutes: {
 *         label: string;
 *         providerId: string | null;
 *         providerModel: string | null;
 *         reasons: string[];
 *     }[];
 * }}
 */
function summarizeRuntimeSelectorAlternatives(candidateEvaluations) {
    /** @type {Record<string, number>} */
    const rejectionReasonCounts = {};
    const providerIds = new Set();
    const topBlockedRoutes = [];
    for (const candidate of candidateEvaluations) {
        const selected = optionalRecord(candidate['selected']);
        const providerId = optionalString(selected?.['providerId']);
        if (providerId) providerIds.add(providerId);
        if (candidate['blocked'] !== true) continue;
        const reasons = candidateBlockReasons(candidate);
        for (const reason of reasons) rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] ?? 0) + 1;
        if (topBlockedRoutes.length < 24) {
            topBlockedRoutes.push({
                label: optionalString(candidate['label']) ?? 'candidate',
                providerId,
                providerModel: optionalString(selected?.['providerModel']),
                reasons,
            });
        }
    }
    return {
        evaluatedCount: candidateEvaluations.length,
        usableCount: candidateEvaluations.filter((candidate) => candidate['blocked'] !== true).length,
        blockedCount: candidateEvaluations.filter((candidate) => candidate['blocked'] === true).length,
        providerCount: providerIds.size,
        rejectionReasonCounts,
        topBlockedRoutes,
    };
}

/**
 * @param {unknown} alternativeSummary
 * @param {{ limit?: number; timeoutMs?: number }} [options]
 * @returns {{
 *     mode: 'agent' | 'chat';
 *     providerId: string;
 *     providerModel: string;
 *     command: string;
 *     reasons: string[];
 * }[]}
 */
export function buildModelGatewayRuntimeProofCommands(alternativeSummary, options = {}) {
    const summary = optionalRecord(alternativeSummary) ?? {};
    const blockedRoutes = Array.isArray(summary['topBlockedRoutes']) ? summary['topBlockedRoutes'] : [];
    const limit =
        typeof options.limit === 'number' && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : 3;
    const timeoutMs =
        typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
            ? Math.max(5_000, Math.floor(options.timeoutMs))
            : 20_000;
    const commands = [];
    const seen = new Set();
    for (const blocked of blockedRoutes) {
        const row = optionalRecord(blocked);
        const providerId = optionalString(row?.['providerId']);
        const providerModel = optionalString(row?.['providerModel']);
        if (!providerId || !providerModel) continue;
        const reasons = Array.isArray(row?.['reasons'])
            ? row['reasons'].map(optionalString).filter((item) => item !== null)
            : [];
        const needsAgentProbe = reasons.some((reason) =>
            /agent_probe_(?:missing|not_verified|failed)|runtime_probe_failed:agent/iu.test(reason),
        );
        const needsChatProbe = reasons.some((reason) => /chat_health_failed|health_unknown/iu.test(reason));
        if (!needsAgentProbe && !needsChatProbe) continue;
        /** @type {'agent' | 'chat'} */
        const mode = needsAgentProbe ? 'agent' : 'chat';
        const command = `/byok probe ${mode} provider:${providerId} model:${providerModel} timeout:${timeoutMs}`;
        if (seen.has(command)) continue;
        seen.add(command);
        commands.push({ mode, providerId, providerModel, command, reasons });
        if (commands.length >= limit) break;
    }
    return commands;
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @returns {string | null}
 */
function runtimeSelectorRouteModel(selected) {
    return (
        optionalString(selected?.['selectorSyntax']) ??
        optionalString(selected?.['providerModel']) ??
        optionalString(selected?.['id'])
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @param {number} timeoutMs
 * @returns {{
 *     probeAgent: string | null;
 *     probeChat: string | null;
 *     liveModel: string | null;
 *     provider: string | null;
 *     persistProvider: string | null;
 *     explicitNewSession: string;
 * }}
 */
function runtimeSelectorStandbyCommands(selected, timeoutMs) {
    const providerId = optionalString(selected?.['providerId']);
    const providerModel = optionalString(selected?.['providerModel']);
    const model = runtimeSelectorRouteModel(selected);
    return {
        probeAgent:
            providerId && providerModel
                ? `/byok probe agent provider:${providerId} model:${providerModel} timeout:${timeoutMs}`
                : null,
        probeChat:
            providerId && providerModel
                ? `/byok probe chat provider:${providerId} model:${providerModel} timeout:${timeoutMs}`
                : null,
        liveModel: model ? `/byok model ${model}` : null,
        provider: providerId && model ? `/byok provider ${providerId} ${model}` : null,
        persistProvider: providerId && model ? `/byok persist provider ${providerId} ${model}` : null,
        explicitNewSession: '/session sdk next new',
    };
}

/**
 * @param {{
 *     hasRuntimeProof: boolean;
 *     standbyClass: 'selected_route' | 'new_model_same_provider' | 'new_provider';
 *     commands: ReturnType<typeof runtimeSelectorStandbyCommands>;
 * }} row
 * @returns {{ action: 'probe_agent' | 'live_model' | 'unavailable'; command: string | null }}
 */
function runtimeSelectorStandbyRecommendation(row) {
    if (!row.hasRuntimeProof) {
        return {
            action: row.commands.probeAgent ? 'probe_agent' : 'unavailable',
            command: row.commands.probeAgent,
        };
    }
    return {
        action: row.commands.liveModel ? 'live_model' : 'unavailable',
        command: row.commands.liveModel,
    };
}

/**
 * @param {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>} runtimeSelectorPlan
 * @param {{ limit?: number; timeoutMs?: number; includeSelected?: boolean }} [options]
 * @returns {{
 *     profileId: string;
 *     rank: number;
 *     source: 'selected' | 'candidate_alternative';
 *     selectedRouteKey: string | null;
 *     providerId: string | null;
 *     providerModel: string | null;
 *     selectorSyntax: string | null;
 *     routeLayer: string | null;
 *     wireApi: string | null;
 *     upstreamProvider: string | null;
 *     score: number | null;
 *     hasRuntimeProof: boolean;
 *     needsProbe: boolean;
 *     standbyClass: 'selected_route' | 'new_model_same_provider' | 'new_provider';
 *     recommendedAction: 'probe_agent' | 'live_model' | 'unavailable';
 *     recommendedCommand: string | null;
 *     runtimeEnvStatus: string | null;
 *     reasons: string[];
 *     commands: ReturnType<typeof runtimeSelectorStandbyCommands>;
 * }[]}
 */
export function buildModelGatewayRuntimeStandbyRoutes(runtimeSelectorPlan, options = {}) {
    const limit =
        typeof options.limit === 'number' && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : 12;
    const timeoutMs =
        typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
            ? Math.max(5_000, Math.floor(options.timeoutMs))
            : 20_000;
    const includeSelected = options.includeSelected !== false;
    const rows = [];
    for (const route of runtimeSelectorPlan.routes) {
        const selectedProviderId = optionalString(optionalRecord(route.selected)?.['providerId']);
        const candidates = [
            ...(includeSelected && route.selected
                ? [
                      {
                          source: /** @type {'selected'} */ ('selected'),
                          selected: route.selected,
                          selectedRouteKey: route.selectedRouteKey,
                          hasRuntimeProof: route.hasRuntimeProof,
                          runtimeEnv: route.runtimeEnv,
                          reasons: route.reasons,
                      },
                  ]
                : []),
            ...route.candidateAlternatives.map((candidate) => ({
                source: /** @type {'candidate_alternative'} */ ('candidate_alternative'),
                selected: optionalRecord(candidate['selected']),
                selectedRouteKey: optionalString(candidate['selectedRouteKey']),
                hasRuntimeProof: candidate['hasRuntimeProof'] === true,
                runtimeEnv: optionalRecord(candidate['runtimeEnv']),
                reasons: stringList(candidate['reasons']),
            })),
        ];
        let rank = 0;
        for (const candidate of candidates) {
            const selected = optionalRecord(candidate.selected);
            if (!selected) continue;
            const providerId = optionalString(selected['providerId']);
            const hasRuntimeProof = candidate.hasRuntimeProof === true;
            rank += 1;
            /** @type {'selected_route' | 'new_model_same_provider' | 'new_provider'} */
            const standbyClass =
                candidate.source === 'selected'
                    ? 'selected_route'
                    : providerId && selectedProviderId && providerId === selectedProviderId
                      ? 'new_model_same_provider'
                      : 'new_provider';
            const commands = runtimeSelectorStandbyCommands(selected, timeoutMs);
            const recommendation = runtimeSelectorStandbyRecommendation({
                hasRuntimeProof,
                standbyClass,
                commands,
            });
            rows.push({
                profileId: route.profileId,
                rank,
                source: candidate.source,
                selectedRouteKey: optionalString(candidate.selectedRouteKey) ?? routeKey(selected),
                providerId,
                providerModel: optionalString(selected['providerModel']),
                selectorSyntax: runtimeSelectorRouteModel(selected),
                routeLayer: routeMetadataString(selected, 'routeLayer'),
                wireApi: routeMetadataString(selected, 'wireApi'),
                upstreamProvider: routeMetadataString(selected, 'upstreamProvider'),
                score: optionalNumber(selected['score']),
                hasRuntimeProof,
                needsProbe: !hasRuntimeProof,
                standbyClass,
                recommendedAction: recommendation.action,
                recommendedCommand: recommendation.command,
                runtimeEnvStatus: optionalString(optionalRecord(candidate.runtimeEnv)?.['status']),
                reasons: candidate.reasons,
                commands,
            });
            if (rows.length >= limit) return rows;
        }
    }
    return rows;
}

/**
 * @param {ReturnType<typeof buildModelGatewayRuntimeSelectorPlan>} runtimeSelectorPlan
 * @param {{
 *     limit?: number;
 *     timeoutMs?: number;
 *     includeSelected?: boolean;
 *     profileId?: string | null;
 *     nextCommandLimit?: number;
 * }} [options]
 * @returns {{
 *     schema: 'model-gateway-runtime-standby-plan';
 *     ok: boolean;
 *     generatedAt: string;
 *     profileId: string | null;
 *     selectorOk: boolean;
 *     runtimeSelectorReady: boolean;
 *     summary: {
 *         routeCount: number;
 *         selectedCount: number;
 *         alternateCount: number;
 *         runtimeProofCount: number;
 *         needsProbeCount: number;
 *         providerCount: number;
 *         selectedRouteCount: number;
 *         newModelSameProviderCount: number;
 *         newProviderCount: number;
 *         sameBoundaryCommandCount: number;
 *         newProviderCommandCount: number;
 *         probeCommandCount: number;
 *         recommendedCommandCount: number;
 *     };
 *     routes: ReturnType<typeof buildModelGatewayRuntimeStandbyRoutes>;
 *     nextCommands: string[];
 * }}
 */
export function buildModelGatewayRuntimeStandbyPlan(runtimeSelectorPlan, options = {}) {
    const routes = buildModelGatewayRuntimeStandbyRoutes(runtimeSelectorPlan, options);
    const nextCommandLimit =
        typeof options.nextCommandLimit === 'number' && Number.isFinite(options.nextCommandLimit)
            ? Math.max(1, Math.floor(options.nextCommandLimit))
            : 5;
    /** @type {string[]} */
    const nextCommandCandidates = routes
        .slice(0, Math.min(routes.length, nextCommandLimit))
        .map((row) => row.recommendedCommand)
        .filter(isNonEmptyString);
    const nextCommands = [...new Set(nextCommandCandidates)];
    return {
        schema: 'model-gateway-runtime-standby-plan',
        ok: routes.length > 0,
        generatedAt: new Date().toISOString(),
        profileId: optionalString(options.profileId),
        selectorOk: runtimeSelectorPlan.ok === true,
        runtimeSelectorReady: runtimeSelectorPlan.ready === true,
        summary: {
            routeCount: routes.length,
            selectedCount: routes.filter((row) => row.source === 'selected').length,
            alternateCount: routes.filter((row) => row.source === 'candidate_alternative').length,
            runtimeProofCount: routes.filter((row) => row.hasRuntimeProof).length,
            needsProbeCount: routes.filter((row) => row.needsProbe).length,
            providerCount: new Set(routes.map((row) => row.providerId).filter(Boolean)).size,
            selectedRouteCount: routes.filter((row) => row.standbyClass === 'selected_route').length,
            newModelSameProviderCount: routes.filter((row) => row.standbyClass === 'new_model_same_provider').length,
            newProviderCount: routes.filter((row) => row.standbyClass === 'new_provider').length,
            sameBoundaryCommandCount: routes.filter((row) => row.commands.liveModel).length,
            newProviderCommandCount: routes.filter((row) => row.commands.provider).length,
            probeCommandCount: routes.filter((row) => row.commands.probeAgent || row.commands.probeChat).length,
            recommendedCommandCount: routes.filter((row) => row.recommendedCommand).length,
        },
        routes,
        nextCommands,
    };
}

/**
 * @param {RuntimeSelectorExecutionRoute} route
 * @param {{ ok: boolean; failure: string | null }} outcome
 * @returns {ReturnType<typeof buildRouteDecisionEvent>}
 */
function buildRuntimeOutcomeDecisionEvent(route, outcome) {
    const selected = route.selected;
    const routeKeyValue = route.selectedRouteKey ?? routeKey(selected);
    return buildRouteDecisionEvent({
        taskProfile: route.profileId,
        routeProfile: optionalString(selected?.['routeProfile']) ?? route.profileId,
        mode: `${route.decisionEvent.mode}:runtime_result`,
        source: `${route.decisionEvent.source}:runtime-result`,
        sessionId: route.decisionEvent.sessionId,
        route: {
            selected: selected
                ? {
                      score: optionalNumber(selected['score']),
                      scoreBreakdown: optionalRecord(selected['scoreBreakdown']),
                      reasons: routeDecisionReasons(selected, null, [
                          ...route.reasons,
                          outcome.ok ? 'runtime_outcome:ok' : 'runtime_outcome:failed',
                      ]),
                      model: {
                          id: selected['id'],
                          providerId: selected['providerId'],
                          providerModel: selected['providerModel'],
                      },
                  }
                : null,
            candidates: selected ? [selected] : [],
            rejected: outcome.ok ? [] : [{ reason: outcome.failure ?? 'runtime_selector_failed' }],
            fallbackChain: routeKeyValue ? [String(routeKeyValue)] : [],
        },
        failure: outcome.failure,
    });
}

/**
 * @param {typeof recordModelGatewayRouteDecision} recordRouteDecision
 * @param {ReturnType<typeof buildRouteDecisionEvent>} event
 * @returns {boolean}
 */
function tryRecordRouteDecision(recordRouteDecision, event) {
    try {
        recordRouteDecision(event);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {Array<Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>>} attempts
 * @returns {number}
 */
function sumRouteDecisionRecordedCount(attempts) {
    return attempts.reduce((total, attempt) => total + (optionalNumber(attempt.routeDecisionRecordedCount) ?? 0), 0);
}

/**
 * @param {Array<Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>>} attempts
 * @param {number} skippedRouteDecisionRecordedCount
 * @returns {number}
 */
function sumFallbackRouteDecisionRecordedCount(attempts, skippedRouteDecisionRecordedCount) {
    return sumRouteDecisionRecordedCount(attempts) + skippedRouteDecisionRecordedCount;
}

/**
 * @param {Record<string, unknown> | null | undefined} selected
 * @returns {string | null}
 */
function runtimeSelectorRouteWireApi(selected) {
    return routeMetadataString(optionalRecord(selected) ?? null, 'wireApi');
}

/**
 * @param {Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>} attempt
 * @param {number} index
 * @param {number} observedAtMs
 * @returns {Record<string, unknown> | null}
 */
function runtimeSelectorAttemptProbeResult(attempt, index, observedAtMs) {
    const route = optionalRecord(attempt.route);
    const selected = optionalRecord(route?.['selected']);
    const probe = optionalRecord(attempt.probe);
    const providerId = optionalString(selected?.['providerId']);
    const providerModel = optionalString(selected?.['providerModel']);
    if (!selected || !probe || !providerId || !providerModel) return null;
    const providerFailure = optionalRecord(attempt.providerFailure) ?? optionalRecord(probe['providerFailure']);
    const routeProfile = optionalString(route?.['profileId']) ?? optionalString(selected['routeProfile']) ?? 'default';
    const ok = probe['ok'] === true;
    return {
        resultKey: `runtime-selector:${observedAtMs}:${index}:${providerId}:${providerModel}:chat`,
        providerId,
        providerModel,
        routeProfile,
        probeKind: 'chat',
        wireApi: runtimeSelectorRouteWireApi(selected),
        ok,
        status: optionalString(probe['status']) ?? (ok ? 'ok' : 'unknown'),
        observedAt: observedAtMs,
        elapsedMs: optionalNumber(probe['elapsedMs']),
        sessionId: optionalString(probe['sessionId']),
        deltaCount: optionalNumber(probe['deltaCount']),
        deltaChars: optionalNumber(probe['deltaChars']),
        finalChars: optionalNumber(probe['finalChars']),
        observedFinalEvent: probe['observedFinalEvent'] === true,
        error: optionalString(attempt.error),
        providerFailure: providerFailure
            ? {
                  kind: optionalString(providerFailure['kind']),
                  errorContext: optionalString(providerFailure['errorContext']),
                  statusCode: optionalNumber(providerFailure['statusCode']),
                  retryAfterSeconds: optionalNumber(providerFailure['retryAfterSeconds']),
                  resetAt: optionalString(providerFailure['resetAt']),
              }
            : null,
    };
}

/**
 * @param {RuntimeSelectorExecutionRoute} route
 * @returns {RuntimeSelectorExecutionRoute[]}
 */
function runtimeSelectorRouteAttempts(route) {
    return [route, ...route.candidateAlternatives];
}

/**
 * @param {RuntimeSelectorExecutionPlan} plan
 * @param {RuntimeSelectorExecutionRoute} route
 * @returns {RuntimeSelectorExecutionPlan}
 */
function runtimeSelectorPlanForRouteAttempt(plan, route) {
    const profileId = optionalString(route['profileId']);
    const routes = plan.routes.map((candidateRoute) =>
        candidateRoute.profileId === profileId ? route : candidateRoute,
    );
    return {
        ...plan,
        routes,
    };
}

/**
 * @param {Record<string, unknown>} selectionPolicyOrTrace
 * @param {{
 *     sessionId?: string | null;
 *     source?: string;
 *     requireRuntimeProof?: boolean;
 *     requireRuntimeEnvReady?: boolean;
 *     requireAgentProbeProfiles?: string[];
 *     preferProviderDiversity?: boolean;
 *     avoidDuplicateRoutes?: boolean;
 *     env?: Record<string, string | undefined>;
 *     runtimeHealthRecords?: Record<string, unknown>[];
 *     runtimeHealthIndex?: ReturnType<typeof createGatewayRuntimeHealthIndex>;
 *     blockFailedProbeKinds?: string[];
 *     now?: string | number | Date;
 *     maxRuntimeProofAgeMs?: number;
 *     temporaryFailureCooldownMs?: number;
 *     providerCooldownWindowMs?: number;
 *     providerCooldownMinFailedModels?: number;
 *     providerCooldownFailureKinds?: string[];
 * }} [options]
 */
export function buildModelGatewayRuntimeSelectorPlan(selectionPolicyOrTrace, options = {}) {
    const input = optionalRecord(selectionPolicyOrTrace) ?? {};
    const { mode, rows, sourceSchema, traceId } = readRowsFromInput(input);
    const requireRuntimeProof = options.requireRuntimeProof === true || mode === 'require_runtime_proof';
    const requireRuntimeEnvReady = options.requireRuntimeEnvReady === true;
    const preferProviderDiversity = options.preferProviderDiversity === true;
    const avoidDuplicateRoutes = options.avoidDuplicateRoutes === true || preferProviderDiversity;
    const runtimeHealthSource =
        options.runtimeHealthIndex ??
        (Array.isArray(options.runtimeHealthRecords)
            ? createGatewayRuntimeHealthIndex(options.runtimeHealthRecords)
            : null);
    const selectedRouteKeysForPlan = new Set();
    const selectedProviderIdsForPlan = new Set();
    const routes = rows.map((row) => {
        const profileId = optionalString(row['profileId']) ?? 'unknown';
        const candidateEvaluations = selectedCandidatesFromPolicyRow(row).map(({ label, selected: rawSelected }) => {
            const selected = runtimeRoute(rawSelected);
            const historicalRuntimeProof = row['hasRuntimeProof'] === true || selected?.['hasRuntimeProof'] === true;
            const runtimeEnv = selected ? evaluateModelGatewayRuntimeSelectorRouteEnv(selected, options.env) : null;
            const runtimeHealth =
                selected && runtimeHealthSource
                    ? evaluateGatewayModelHealthRoute(selected, {
                          routeProfile: profileId,
                          runtimeHealthIndex: runtimeHealthSource,
                          ...(options.now !== undefined ? { now: options.now } : {}),
                          ...(typeof options.maxRuntimeProofAgeMs === 'number'
                              ? { maxRuntimeProofAgeMs: options.maxRuntimeProofAgeMs }
                              : {}),
                          ...(typeof options.temporaryFailureCooldownMs === 'number'
                              ? { temporaryFailureCooldownMs: options.temporaryFailureCooldownMs }
                              : {}),
                          requireAgentProbeOk: runtimeSelectorProfileRequiresAgentProbe(profileId, options),
                      })
                    : null;
            const hasRuntimeProof = runtimeHealthSource
                ? runtimeHealth?.runtimeProof?.hasFreshProof === true
                : historicalRuntimeProof;
            const runtimeProofStale = runtimeHealthSource
                ? runtimeHealth?.runtimeProof?.stale === true ||
                  (historicalRuntimeProof && runtimeHealth?.runtimeProof?.hasFreshProof !== true)
                : false;
            const providerCooldown =
                selected && runtimeHealthSource
                    ? evaluateGatewayProviderHealthCooldown(selected, runtimeHealthSource, {
                          ...(options.now !== undefined ? { now: options.now } : {}),
                          ...(typeof options.providerCooldownWindowMs === 'number'
                              ? { windowMs: options.providerCooldownWindowMs }
                              : {}),
                          ...(typeof options.providerCooldownMinFailedModels === 'number'
                              ? { minFailedModels: options.providerCooldownMinFailedModels }
                              : {}),
                          ...(Array.isArray(options.providerCooldownFailureKinds)
                              ? { failureKinds: options.providerCooldownFailureKinds }
                              : {}),
                      })
                    : null;
            const runtimeEnvBlocked = requireRuntimeEnvReady && runtimeEnv?.status !== 'ready';
            const accountAccessBlocked = selected !== null && !routeAccountCanAttempt(selected);
            const runtimeHealthBlocked = runtimeHealth?.include === false;
            const providerCooldownBlocked = providerCooldown?.include === false;
            const failedProbeKinds = Array.isArray(options.blockFailedProbeKinds)
                ? options.blockFailedProbeKinds.filter(
                      (kind) =>
                          runtimeHealth?.health &&
                          isGatewayModelProbeActivelyFailed(runtimeHealth.health, kind, {
                              ...(options.now !== undefined ? { now: options.now } : {}),
                              ...(typeof options.temporaryFailureCooldownMs === 'number'
                                  ? { temporaryFailureCooldownMs: options.temporaryFailureCooldownMs }
                                  : {}),
                          }),
                  )
                : [];
            const runtimeProbeBlocked = failedProbeKinds.length > 0;
            return {
                label,
                selected,
                hasRuntimeProof,
                runtimeProofStale,
                runtimeEnv,
                runtimeHealth,
                providerCooldown,
                runtimeEnvBlocked,
                accountAccessBlocked,
                runtimeHealthBlocked,
                providerCooldownBlocked,
                failedProbeKinds,
                runtimeProbeBlocked,
                runtimeProofBlocked: requireRuntimeProof && !hasRuntimeProof,
                blocked:
                    !selected ||
                    accountAccessBlocked ||
                    (requireRuntimeProof && !hasRuntimeProof) ||
                    runtimeEnvBlocked ||
                    runtimeHealthBlocked ||
                    runtimeProbeBlocked ||
                    providerCooldownBlocked,
            };
        });
        const primary = candidateEvaluations[0] ?? null;
        const usableCandidates = candidateEvaluations.filter((candidate) => !candidate.blocked);
        let chosen = primary && !primary.blocked ? primary : (usableCandidates[0] ?? primary);
        if (avoidDuplicateRoutes) {
            const primaryProviderId = optionalString(primary?.selected?.['providerId']);
            const primaryAvailable =
                primary &&
                !primary.blocked &&
                !selectedRouteKeysForPlan.has(routeKey(primary.selected)) &&
                (!preferProviderDiversity || !primaryProviderId || !selectedProviderIdsForPlan.has(primaryProviderId));
            const unseenProviderCandidate = preferProviderDiversity
                ? usableCandidates.find((candidate) => {
                      const key = routeKey(candidate.selected);
                      const providerId = optionalString(candidate.selected?.['providerId']);
                      return (
                          key &&
                          !selectedRouteKeysForPlan.has(key) &&
                          providerId &&
                          !selectedProviderIdsForPlan.has(providerId)
                      );
                  })
                : null;
            chosen = primaryAvailable
                ? primary
                : (unseenProviderCandidate ??
                  usableCandidates.find((candidate) => !selectedRouteKeysForPlan.has(routeKey(candidate.selected))) ??
                  (primary && !primary.blocked ? primary : (usableCandidates[0] ?? primary)));
        }
        const selected = routeWithRuntimeProfile(chosen?.blocked ? null : (chosen?.selected ?? null), profileId);
        const alternativeSummary = summarizeRuntimeSelectorAlternatives(candidateEvaluations);
        const selectedForReasons = routeWithRuntimeProfile(
            chosen?.selected ?? runtimeRoute(selectedFromPolicyRow(row)),
            profileId,
        );
        const hasRuntimeProof = chosen?.hasRuntimeProof === true;
        const runtimeProofStale = chosen?.runtimeProofStale === true;
        const runtimeEnv = chosen?.runtimeEnv ?? null;
        const runtimeHealth = chosen?.runtimeHealth ?? null;
        const providerCooldown = chosen?.providerCooldown ?? null;
        const runtimeEnvBlocked = chosen?.runtimeEnvBlocked === true;
        const accountAccessBlocked = chosen?.accountAccessBlocked === true;
        const runtimeHealthBlocked = chosen?.runtimeHealthBlocked === true;
        const providerCooldownBlocked = chosen?.providerCooldownBlocked === true;
        const failedProbeKinds = chosen?.failedProbeKinds ?? [];
        const runtimeProbeBlocked = chosen?.runtimeProbeBlocked === true;
        const blocked = !selected;
        /** @type {'selected' | 'blocked'} */
        const status = blocked ? 'blocked' : 'selected';
        const selectedWithProofFlag = routeWithRuntimeProofFlag(selected, hasRuntimeProof);
        if (!blocked) {
            const key = routeKey(selectedWithProofFlag);
            if (key) selectedRouteKeysForPlan.add(key);
            const providerId = optionalString(selectedWithProofFlag?.['providerId']);
            if (providerId) selectedProviderIdsForPlan.add(providerId);
        }
        const reasons = selectionReasons(routeWithRuntimeProofFlag(selectedForReasons, hasRuntimeProof), row);
        if (runtimeProofStale) reasons.push('runtime_proof:stale');
        if (chosen?.label && chosen.label !== 'selected') reasons.push(`runtime_selector_fallback:${chosen.label}`);
        if (blocked && !selected) reasons.push('blocked:no_selected_route');
        if (blocked && accountAccessBlocked) reasons.push('blocked:account_access_denies_attempt');
        if (blocked && chosen?.selected && requireRuntimeProof && !hasRuntimeProof)
            reasons.push('blocked:runtime_proof_required');
        if (blocked && chosen?.selected && runtimeEnvBlocked) reasons.push('blocked:runtime_env_not_ready');
        if (blocked && chosen?.selected && runtimeHealthBlocked)
            reasons.push(`blocked:runtime_health:${runtimeHealth?.reason ?? 'failed'}`);
        if (blocked && chosen?.selected && providerCooldownBlocked) {
            reasons.push(`blocked:provider_health_cooldown:${providerCooldown?.failureKinds.join('+') || 'temporary'}`);
        }
        for (const kind of failedProbeKinds) reasons.push(`blocked:runtime_probe_failed:${kind}`);
        const normalizedRow = {
            ...row,
            profileId,
            source: optionalString(row['source']) ?? 'unknown',
            hasRuntimeProof,
        };
        /** @type {'selected'} */
        const selectedAlternativeStatus = 'selected';
        const candidateAlternatives = candidateEvaluations
            .filter((candidate) => candidate !== chosen && candidate.blocked !== true && candidate.selected !== null)
            .map((candidate) => {
                const candidateSelected = routeWithRuntimeProfile(candidate.selected, profileId);
                const candidateHasRuntimeProof = candidate['hasRuntimeProof'] === true;
                const candidateRuntimeProofStale = candidate['runtimeProofStale'] === true;
                const candidateSelectedWithProofFlag = routeWithRuntimeProofFlag(
                    candidateSelected,
                    candidateHasRuntimeProof,
                );
                const label = optionalString(candidate['label']);
                const candidateReasons = selectionReasons(candidateSelectedWithProofFlag, row);
                if (candidateRuntimeProofStale) candidateReasons.push('runtime_proof:stale');
                if (label && label !== 'selected') candidateReasons.push(`runtime_selector_fallback:${label}`);
                return {
                    profileId,
                    status: selectedAlternativeStatus,
                    source: String(normalizedRow['source']),
                    selected: candidateSelectedWithProofFlag,
                    selectedRouteKey: routeKey(candidateSelectedWithProofFlag),
                    hasRuntimeProof: candidateHasRuntimeProof,
                    runtimeProofStale: candidateRuntimeProofStale,
                    runtimeProof: candidate.runtimeHealth?.runtimeProof ?? null,
                    runtimeEnv: candidate.runtimeEnv,
                    runtimeHealth: candidate.runtimeHealth,
                    providerCooldown: candidate.providerCooldown,
                    alternativeSummary,
                    candidateAlternatives: [],
                    reasons: candidateReasons,
                    nextActions: ['attempt_selected_route', 'record_runtime_result'],
                    decisionEvent: buildSelectorDecisionEvent(candidateSelectedWithProofFlag, normalizedRow, {
                        mode,
                        ...(options.source ? { source: options.source } : {}),
                        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                    }),
                };
            });
        return {
            profileId,
            status,
            source: String(normalizedRow['source']),
            selected: blocked ? null : selectedWithProofFlag,
            selectedRouteKey: blocked ? null : routeKey(selectedWithProofFlag),
            hasRuntimeProof,
            runtimeProofStale,
            runtimeProof: runtimeHealth?.runtimeProof ?? null,
            runtimeEnv,
            runtimeHealth,
            providerCooldown,
            alternativeSummary,
            candidateAlternatives,
            reasons,
            nextActions: blocked
                ? [
                      ...(accountAccessBlocked ? ['refresh_account_overlay_or_choose_accessible_model'] : []),
                      ...(runtimeEnvBlocked ? ['configure_provider_env_for_selected_route'] : []),
                      ...(runtimeHealthBlocked || runtimeProbeBlocked || providerCooldownBlocked
                          ? ['choose_route_without_failed_runtime_health']
                          : []),
                      ...(providerCooldownBlocked ? ['wait_for_provider_cooldown_or_probe_different_provider'] : []),
                      'run_runtime_probe_for_profile',
                      'relax_selection_policy_or_choose_fallback',
                  ]
                : ['attempt_selected_route', 'record_runtime_result'],
            decisionEvent: buildSelectorDecisionEvent(blocked ? null : selectedWithProofFlag, normalizedRow, {
                mode,
                ...(options.source ? { source: options.source } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
            }),
        };
    });
    return {
        schema: 'model-gateway-runtime-selector-plan',
        ok: routes.every((route) => route.status === 'selected'),
        ready: routes.some((route) => route.status === 'selected'),
        mode,
        sourceSchema,
        traceId,
        summary: {
            profileCount: routes.length,
            selectedProfileCount: routes.filter((route) => route.status === 'selected').length,
            blockedProfileCount: routes.filter((route) => route.status === 'blocked').length,
            accountAccessBlockedCount: routes.filter((route) =>
                route.reasons.includes('blocked:account_access_denies_attempt'),
            ).length,
            runtimeProofSelectedCount: routes.filter((route) => route.status === 'selected' && route.hasRuntimeProof)
                .length,
            runtimeEnvReadyCount: routes.filter((route) => route.runtimeEnv?.status === 'ready').length,
            runtimeEnvBlockedCount: routes.filter(
                (route) => route.runtimeEnv !== null && route.runtimeEnv.status !== 'ready',
            ).length,
            runtimeHealthBlockedCount: routes.filter((route) =>
                route.reasons.some((reason) => reason.startsWith('blocked:runtime_health:')),
            ).length,
            runtimeProbeBlockedCount: routes.filter((route) =>
                route.reasons.some((reason) => reason.startsWith('blocked:runtime_probe_failed:')),
            ).length,
            providerCooldownBlockedCount: routes.filter((route) =>
                route.reasons.some((reason) => reason.startsWith('blocked:provider_health_cooldown:')),
            ).length,
            alternativeEvaluatedCount: routes.reduce((sum, route) => sum + route.alternativeSummary.evaluatedCount, 0),
            alternativeUsableCount: routes.reduce((sum, route) => sum + route.alternativeSummary.usableCount, 0),
        },
        routes,
    };
}

/**
 * @param {RuntimeSelectorExecutionPlan} plan
 * @param {string} profileId
 * @returns {RuntimeSelectorExecutionRoute | null}
 */
export function selectModelGatewayRuntimeRoute(plan, profileId) {
    return plan.routes.find((route) => route.profileId === profileId && route.status === 'selected') ?? null;
}

/**
 * @param {RuntimeSelectorExecutionPlan} plan
 * @param {{
 *     profileId?: string;
 *     timeoutMs?: number;
 *     prompt?: string;
 *     recordHealth?: boolean;
 *     env?: Record<string, string | undefined>;
 *     deps?: {
 *         runChatProbe?: RuntimeSelectorProbeRunner;
 *         recordSuccess?: typeof recordByokProviderModelCallSuccess;
 *         recordFailure?: typeof recordByokProviderModelCallFailure;
 *         flushHealth?: typeof flushByokProviderHealth;
 *         classifyProviderFailure?: typeof classifyByokProviderFailure;
 *         recordRouteDecision?: typeof recordModelGatewayRouteDecision;
 *     };
 * }} [options]
 * @returns {Promise<{
 *     schema: 'model-gateway-runtime-selector-execution-result';
 *     ok: boolean;
 *     status: 'ok' | 'blocked' | 'failed';
 *     profileId: string | null;
 *     route: ReturnType<typeof selectModelGatewayRuntimeRoute> | null;
 *     probe: RuntimeSelectorProbeResult | null;
 *     providerFailure: ReturnType<typeof classifyByokProviderFailure> | null;
 *     failureScope: 'provider' | 'controller_substrate' | 'preflight' | null;
 *     healthRecorded: boolean;
 *     routeDecisionRecordedCount: number;
 *     error: string | null;
 * }>}
 */
export async function executeModelGatewayRuntimeSelectorPlan(plan, options = {}) {
    const requestedProfile = optionalString(options.profileId);
    const route =
        requestedProfile !== null
            ? selectModelGatewayRuntimeRoute(plan, requestedProfile)
            : (plan.routes.find((candidate) => candidate.status === 'selected') ?? null);
    if (!route?.selected) {
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: false,
            status: 'blocked',
            profileId: requestedProfile,
            route: null,
            probe: null,
            providerFailure: null,
            failureScope: null,
            healthRecorded: false,
            routeDecisionRecordedCount: 0,
            error: 'runtime_selector_route_unavailable',
        };
    }
    const selected = route.selected;
    const runChatProbe = options.deps?.runChatProbe ?? runConfiguredByokChatProbe;
    const recordSuccess = options.deps?.recordSuccess ?? recordByokProviderModelCallSuccess;
    const recordFailure = options.deps?.recordFailure ?? recordByokProviderModelCallFailure;
    const flushHealth = options.deps?.flushHealth ?? flushByokProviderHealth;
    const classifyProviderFailure = options.deps?.classifyProviderFailure ?? classifyByokProviderFailure;
    const recordRouteDecision = options.deps?.recordRouteDecision ?? recordModelGatewayRouteDecision;
    const recordHealth = options.recordHealth !== false;
    let routeDecisionRecordedCount = 0;
    const providerModel = optionalString(selected['providerModel']);
    const probeEnv = buildModelGatewayRuntimeSelectorProbeEnv(selected, options.env);
    const identity = {
        routeProfile: route.profileId,
        providerId: optionalString(selected['providerId']),
        providerModel,
    };
    try {
        if (tryRecordRouteDecision(recordRouteDecision, route.decisionEvent)) routeDecisionRecordedCount += 1;
        const probe = await runChatProbe({
            env: probeEnv,
            ...(providerModel ? { model: providerModel } : {}),
            ...(typeof options.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.prompt ? { prompt: options.prompt } : {}),
            deps: { classifyProviderFailure },
        });
        const providerAttempted = didConfiguredByokProbeAttemptProvider(probe);
        const failureScope = classifyConfiguredByokProbeFailureScope(probe);
        let healthRecorded = false;
        if (recordHealth && probe.ok && providerAttempted) {
            recordSuccess({
                ...identity,
                successContext: 'runtime_selector_chat',
            });
            await flushHealth();
            healthRecorded = true;
        } else if (recordHealth && providerAttempted) {
            recordFailure({
                ...identity,
                message: probe.errors[0] ?? `runtime selector chat ${probe.status}`,
                errorContext: probe.providerFailure?.errorContext ?? 'runtime_selector_chat',
                failureKind: probe.providerFailure?.kind ?? null,
                failureStatusCode: probe.providerFailure?.statusCode ?? null,
                retryAfterSeconds: probe.providerFailure?.retryAfterSeconds ?? null,
                resetAt: probe.providerFailure?.resetAt ?? null,
            });
            await flushHealth();
            healthRecorded = true;
        }
        const failure = probe.ok
            ? null
            : providerAttempted
              ? `runtime_probe_failed:${probe.status}`
              : `runtime_controller_substrate_failed:${probe.status}`;
        if (
            tryRecordRouteDecision(
                recordRouteDecision,
                buildRuntimeOutcomeDecisionEvent(route, { ok: probe.ok, failure }),
            )
        ) {
            routeDecisionRecordedCount += 1;
        }
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: probe.ok,
            status: probe.ok ? 'ok' : 'failed',
            profileId: route.profileId,
            route,
            probe,
            providerFailure: providerAttempted ? (probe.providerFailure ?? null) : null,
            failureScope,
            healthRecorded,
            routeDecisionRecordedCount,
            error: probe.ok ? null : (probe.errors[0] ?? probe.status),
        };
    } catch (error) {
        // `runConfiguredByokChatProbe` reports provider-call failures as a probe result. A throw escaping that contract
        // therefore has no evidence that the BYOK provider boundary was crossed; treating it as provider health would
        // poison every candidate when the shared Copilot SDK/session substrate is unavailable.
        const message = error instanceof Error ? error.message : String(error);
        if (
            tryRecordRouteDecision(
                recordRouteDecision,
                buildRuntimeOutcomeDecisionEvent(route, {
                    ok: false,
                    failure: 'runtime_controller_substrate_failed:exception',
                }),
            )
        ) {
            routeDecisionRecordedCount += 1;
        }
        return {
            schema: 'model-gateway-runtime-selector-execution-result',
            ok: false,
            status: 'failed',
            profileId: route.profileId,
            route,
            probe: null,
            providerFailure: null,
            failureScope: 'controller_substrate',
            healthRecorded: false,
            routeDecisionRecordedCount,
            error: message,
        };
    }
}

/**
 * @param {Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>} execution
 * @param {{ retryDelayMs?: number; maxRetryDelayMs?: number; now?: string | number | Date }} [options]
 * @returns {{
 *     schema: 'model-gateway-runtime-selector-retry-decision';
 *     retryRoute: boolean;
 *     fallbackRoute: boolean;
 *     permanent: boolean;
 *     waitMs: number;
 *     reason: string;
 *     failureKind: string | null;
 *     retryAfterSeconds: number | null;
 *     resetAt: string | null;
 *     resetWindow: ReturnType<typeof resolveModelGatewayAccountResetWindow> | null;
 * }}
 */
export function resolveModelGatewayRuntimeRetryDecision(execution, options = {}) {
    if (execution.ok) {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: false,
            permanent: false,
            waitMs: 0,
            reason: 'runtime_route_succeeded',
            failureKind: null,
            retryAfterSeconds: null,
            resetAt: null,
            resetWindow: null,
        };
    }
    const failureScope =
        optionalString(execution.failureScope) ??
        classifyConfiguredByokProbeFailureScope(optionalRecord(execution.probe));
    const providerFailure =
        optionalRecord(execution.providerFailure) ?? optionalRecord(execution.probe?.providerFailure);
    const failureKind = optionalString(providerFailure?.['kind']);
    const retryAfterSeconds = optionalNumber(providerFailure?.['retryAfterSeconds']);
    const resetAt = optionalString(providerFailure?.['resetAt']);
    const nowMs = dateMs(options.now) ?? Date.now();
    const resetWindow = resolveModelGatewayAccountResetWindow(
        {
            failureKind,
            retryAfterSeconds,
            resetAt,
            observedAt: options.now ?? nowMs,
        },
        { now: nowMs },
    );
    const fallbackDelayMs = positiveInteger(options.retryDelayMs) ?? 0;
    const maxRetryDelayMs = positiveInteger(options.maxRetryDelayMs) ?? DEFAULT_MAX_RUNTIME_RETRY_DELAY_MS;
    if (execution.status === 'blocked') {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: true,
            permanent: false,
            waitMs: 0,
            reason: 'runtime_route_blocked',
            failureKind,
            retryAfterSeconds,
            resetAt,
            resetWindow,
        };
    }
    if (failureScope === 'controller_substrate') {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: false,
            permanent: false,
            waitMs: 0,
            reason: 'controller_substrate_failure',
            failureKind: null,
            retryAfterSeconds: null,
            resetAt: null,
            resetWindow: null,
        };
    }
    if (
        failureKind === 'auth' ||
        failureKind === 'credits' ||
        failureKind === 'model-or-route' ||
        failureKind === 'capability-unsupported' ||
        failureKind === 'invalid-request'
    ) {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: true,
            permanent: true,
            waitMs: 0,
            reason: `permanent_provider_failure:${failureKind}`,
            failureKind,
            retryAfterSeconds,
            resetAt,
            resetWindow,
        };
    }
    const waitMs = resolveRuntimeRetryDelayMs(retryAfterSeconds, resetAt, nowMs, fallbackDelayMs);
    if (failureKind === 'rate-limit' && waitMs > maxRetryDelayMs) {
        return {
            schema: 'model-gateway-runtime-selector-retry-decision',
            retryRoute: false,
            fallbackRoute: true,
            permanent: false,
            waitMs,
            reason: 'rate_limit_window_exceeds_runtime_retry_budget',
            failureKind,
            retryAfterSeconds,
            resetAt,
            resetWindow,
        };
    }
    return {
        schema: 'model-gateway-runtime-selector-retry-decision',
        retryRoute: true,
        fallbackRoute: true,
        permanent: false,
        waitMs,
        reason: failureKind ? `retryable_provider_failure:${failureKind}` : 'retryable_runtime_failure',
        failureKind,
        retryAfterSeconds,
        resetAt,
        resetWindow,
    };
}

/**
 * @param {RuntimeSelectorExecutionPlan} plan
 * @param {{
 *     profileId?: string;
 *     fallbackProfileIds?: string[];
 *     maxAttempts?: number;
 *     maxAttemptsPerProvider?: number;
 *     attemptsPerRoute?: number;
 *     retryDelayMs?: number;
 *     maxRetryDelayMs?: number;
 *     timeoutMs?: number;
 *     prompt?: string;
 *     recordHealth?: boolean;
 *     env?: Record<string, string | undefined>;
 *     deps?: {
 *         runChatProbe?: RuntimeSelectorProbeRunner;
 *         recordSuccess?: typeof recordByokProviderModelCallSuccess;
 *         recordFailure?: typeof recordByokProviderModelCallFailure;
 *         flushHealth?: typeof flushByokProviderHealth;
 *         classifyProviderFailure?: typeof classifyByokProviderFailure;
 *         recordRouteDecision?: typeof recordModelGatewayRouteDecision;
 *         sleep?: typeof sleepMs;
 *     };
 * }} [options]
 * @returns {Promise<{
 *     schema: 'model-gateway-runtime-selector-fallback-execution-result';
 *     ok: boolean;
 *     status: 'ok' | 'blocked' | 'failed';
 *     attemptedCount: number;
 *     selectedProfileId: string | null;
 *     attempts: Array<Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>>;
 *     retryDecisions: ReturnType<typeof resolveModelGatewayRuntimeRetryDecision>[];
 *     skippedAttemptCount: number;
 *     skippedAttempts: Record<string, unknown>[];
 *     routeDecisionRecordedCount: number;
 *     final: Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>> | null;
 *     error: string | null;
 * }>}
 */
export async function executeModelGatewayRuntimeSelectorPlanWithFallbacks(plan, options = {}) {
    const selectedRoutes = plan.routes.filter((route) => route.status === 'selected');
    const requestedProfile = optionalString(options.profileId);
    const fallbackProfileIds = Array.isArray(options.fallbackProfileIds)
        ? options.fallbackProfileIds.map(optionalString).filter((item) => item !== null)
        : [];
    const orderedProfileIds = [
        ...(requestedProfile ? [requestedProfile] : []),
        ...fallbackProfileIds,
        ...selectedRoutes.map((route) => route.profileId),
    ];
    const uniqueProfileIds = [...new Set(orderedProfileIds)].filter((profileId) =>
        selectedRoutes.some((route) => route.profileId === profileId),
    );
    const attemptsPerRoute =
        typeof options.attemptsPerRoute === 'number' &&
        Number.isFinite(options.attemptsPerRoute) &&
        options.attemptsPerRoute > 0
            ? Math.floor(options.attemptsPerRoute)
            : 1;
    const retryDelayMs =
        typeof options.retryDelayMs === 'number' && Number.isFinite(options.retryDelayMs) && options.retryDelayMs > 0
            ? Math.round(options.retryDelayMs)
            : 0;
    const wait = options.deps?.sleep ?? sleepMs;
    const routeByProfileId = new Map(selectedRoutes.map((route) => [route.profileId, route]));
    const orderedRuntimeProfileIds = orderRuntimeSelectorAttemptProfileIds(
        uniqueProfileIds,
        routeByProfileId,
        plan.mode === 'prefer_runtime_proved',
    );
    const attemptedRouteKeys = new Set();
    const routeAttempts = [];
    for (const profileId of orderedRuntimeProfileIds) {
        const route = routeByProfileId.get(profileId);
        if (!route) continue;
        for (const candidateRoute of runtimeSelectorRouteAttempts(route)) {
            const key = runtimeSelectorAttemptKey(candidateRoute);
            if (key && attemptedRouteKeys.has(key)) continue;
            if (key) attemptedRouteKeys.add(key);
            routeAttempts.push({ profileId, route: candidateRoute });
        }
    }
    const maxAttempts =
        typeof options.maxAttempts === 'number' && Number.isFinite(options.maxAttempts) && options.maxAttempts > 0
            ? Math.floor(options.maxAttempts)
            : routeAttempts.length * attemptsPerRoute;
    const maxAttemptsPerProvider =
        typeof options.maxAttemptsPerProvider === 'number' &&
        Number.isFinite(options.maxAttemptsPerProvider) &&
        options.maxAttemptsPerProvider > 0
            ? Math.floor(options.maxAttemptsPerProvider)
            : 4;
    const providerAttemptCounts = new Map();
    const recordRouteDecision = options.deps?.recordRouteDecision ?? recordModelGatewayRouteDecision;
    /** @type {Array<Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>>} */
    const attempts = [];
    /** @type {ReturnType<typeof resolveModelGatewayRuntimeRetryDecision>[]} */
    const retryDecisions = [];
    /** @type {Record<string, unknown>[]} */
    const skippedAttempts = [];
    let skippedRouteDecisionRecordedCount = 0;
    routeLoop: for (const { profileId, route } of routeAttempts) {
        if (attempts.length >= maxAttempts) break;
        const providerId = optionalString(route.selected?.['providerId']) ?? 'unknown-provider';
        if ((providerAttemptCounts.get(providerId) ?? 0) >= maxAttemptsPerProvider) {
            const failure = 'runtime_selector_skipped:provider_attempt_cap';
            skippedAttempts.push({
                profileId,
                selectedRouteKey: runtimeSelectorAttemptKey(route),
                providerId,
                reason: failure,
                maxAttemptsPerProvider,
            });
            if (
                tryRecordRouteDecision(
                    recordRouteDecision,
                    buildRuntimeOutcomeDecisionEvent(route, { ok: false, failure }),
                )
            ) {
                skippedRouteDecisionRecordedCount += 1;
            }
            continue;
        }
        for (let routeAttempt = 0; routeAttempt < attemptsPerRoute; routeAttempt += 1) {
            if (attempts.length >= maxAttempts) break routeLoop;
            if ((providerAttemptCounts.get(providerId) ?? 0) >= maxAttemptsPerProvider) break;
            providerAttemptCounts.set(providerId, (providerAttemptCounts.get(providerId) ?? 0) + 1);
            const attempt = await executeModelGatewayRuntimeSelectorPlan(
                runtimeSelectorPlanForRouteAttempt(plan, route),
                {
                    profileId,
                    ...(typeof options.timeoutMs === 'number' ? { timeoutMs: options.timeoutMs } : {}),
                    ...(options.prompt ? { prompt: options.prompt } : {}),
                    ...(options.recordHealth !== undefined ? { recordHealth: options.recordHealth } : {}),
                    ...(options.env ? { env: options.env } : {}),
                    ...(options.deps ? { deps: options.deps } : {}),
                },
            );
            attempts.push(attempt);
            if (attempt.ok) {
                return {
                    schema: 'model-gateway-runtime-selector-fallback-execution-result',
                    ok: true,
                    status: 'ok',
                    attemptedCount: attempts.length,
                    selectedProfileId: attempt.profileId,
                    attempts,
                    retryDecisions,
                    skippedAttemptCount: skippedAttempts.length,
                    skippedAttempts,
                    routeDecisionRecordedCount: sumFallbackRouteDecisionRecordedCount(
                        attempts,
                        skippedRouteDecisionRecordedCount,
                    ),
                    final: attempt,
                    error: null,
                };
            }
            const retryDecision = resolveModelGatewayRuntimeRetryDecision(attempt, {
                retryDelayMs,
                ...(typeof options.maxRetryDelayMs === 'number' ? { maxRetryDelayMs: options.maxRetryDelayMs } : {}),
            });
            retryDecisions.push(retryDecision);
            if (routeAttempt + 1 < attemptsPerRoute && retryDecision.retryRoute) {
                await wait(retryDecision.waitMs);
                continue;
            }
            if (!retryDecision.fallbackRoute) break routeLoop;
            break;
        }
    }
    const final = attempts.at(-1) ?? null;
    return {
        schema: 'model-gateway-runtime-selector-fallback-execution-result',
        ok: false,
        status: attempts.length === 0 ? 'blocked' : 'failed',
        attemptedCount: attempts.length,
        selectedProfileId: null,
        attempts,
        retryDecisions,
        skippedAttemptCount: skippedAttempts.length,
        skippedAttempts,
        routeDecisionRecordedCount: sumFallbackRouteDecisionRecordedCount(attempts, skippedRouteDecisionRecordedCount),
        final,
        error: final?.error ?? 'runtime_selector_no_available_attempts',
    };
}

/**
 * Convert a runtime-selector execution into the neutral SQLite runtime-probe run shape.
 *
 * The generated object is intentionally catalog-neutral: it captures proof attempts and probe statuses, but does not
 * mutate model metadata, account overlays or eligibility decisions.
 *
 * @param {Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlanWithFallbacks>>
 *     | Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>
 *     | null} execution
 * @param {{
 *     runId?: string;
 *     observedAt?: string | number | Date;
 *     accountScope?: string | null;
 *     probeProfile?: string | null;
 * }} [options]
 * @returns {{
 *     schema: 'model-gateway-runtime-selector-probe-run';
 *     runId?: string;
 *     probeProfile: string;
 *     accountScope: string;
 *     status: string;
 *     startedAt: number;
 *     completedAt: number;
 *     skippedCount: number;
 *     payload: Record<string, unknown>;
 *     results: Record<string, unknown>[];
 * }}
 */
export function buildModelGatewayRuntimeSelectorProbeRun(execution, options = {}) {
    const observedAtMs = dateMs(options.observedAt) ?? Date.now();
    const executionRecord = optionalRecord(execution);
    const attempts = Array.isArray(executionRecord?.['attempts'])
        ? executionRecord['attempts'].map((attempt) => optionalRecord(attempt)).filter((attempt) => attempt !== null)
        : executionRecord
          ? [executionRecord]
          : [];
    const results = attempts
        .map((attempt, index) =>
            runtimeSelectorAttemptProbeResult(
                /** @type {Awaited<ReturnType<typeof executeModelGatewayRuntimeSelectorPlan>>} */ (attempt),
                index,
                observedAtMs,
            ),
        )
        .filter((result) => result !== null);
    const selectedProfileId =
        optionalString(executionRecord?.['selectedProfileId']) ?? optionalString(executionRecord?.['profileId']);
    const status = executionRecord?.['ok'] === true ? 'completed' : attempts.length > 0 ? 'failed' : 'blocked';
    const skippedCount = Math.max(0, optionalNumber(executionRecord?.['skippedAttemptCount']) ?? 0);
    /**
     * @type {{
     *     schema: 'model-gateway-runtime-selector-probe-run';
     *     runId?: string;
     *     probeProfile: string;
     *     accountScope: string;
     *     status: string;
     *     startedAt: number;
     *     completedAt: number;
     *     skippedCount: number;
     *     payload: Record<string, unknown>;
     *     results: Record<string, unknown>[];
     * }}
     */
    const run = {
        schema: 'model-gateway-runtime-selector-probe-run',
        probeProfile: optionalString(options.probeProfile) ?? selectedProfileId ?? 'runtime-selector',
        accountScope: optionalString(options.accountScope) ?? 'default',
        status,
        startedAt: observedAtMs,
        completedAt: observedAtMs,
        skippedCount,
        payload: {
            source: 'model-gateway-runtime-selector',
            executionStatus: optionalString(executionRecord?.['status']) ?? status,
            executionOk: executionRecord?.['ok'] === true,
            attemptedCount: optionalNumber(executionRecord?.['attemptedCount']) ?? attempts.length,
            skippedAttemptCount: skippedCount,
            selectedProfileId,
            resultCount: results.length,
        },
        results,
    };
    const runId = optionalString(options.runId);
    if (runId) run.runId = runId;
    return run;
}
