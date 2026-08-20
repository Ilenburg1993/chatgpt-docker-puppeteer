// @ts-check
/**
 * Compatibility importer for the current BYOK env/preset implementation.
 *
 * This is the migration hinge: the gateway can observe and project today's BYOK state without making terminal/runtime
 * choose between two independent configuration flows.
 *
 * @module copilot/model-gateway/registry/env-byok-compat-importer
 */

import { readConfiguredByokModelsFromEnv, readConfiguredByokState } from '#copilot/sdk/session';
import {
    buildProviderModelId,
    createModelRecord,
    createProviderRecord,
    normalizeGatewayIdPart,
    optionalPositiveInteger,
} from '../contracts/records.js';
import {
    createModelGatewayEnvProfileStore,
    materializeModelGatewayActiveByokProfileEnv,
} from '../profiles/env-profile-store.js';
import { createEnvSecretRegistry } from '../secrets/env-secret-registry.js';
import { resolveModelGatewayProviderSecretRefs } from '../secrets/requirements.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function optionalNonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * @param {ReturnType<typeof readConfiguredByokState>} state
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function resolveProviderId(state, env) {
    const gatewayProviderId = env['COPILOT_MODEL_GATEWAY_PROVIDER_ID'];
    if (typeof gatewayProviderId === 'string' && gatewayProviderId.trim())
        return gatewayProviderId.trim().toLowerCase();
    const activeProfile = createModelGatewayEnvProfileStore({ env }).getActive();
    if (typeof activeProfile?.providerId === 'string' && activeProfile.providerId.trim()) {
        return activeProfile.providerId.trim().toLowerCase();
    }
    return (
        normalizeGatewayIdPart(state.summary.preset ?? state.summary.providerType ?? 'byok-configured') ||
        'byok-configured'
    );
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {'gateway_route' | 'gateway_profile' | 'env_compat'}
 */
function bindingSource(env) {
    if (env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'] === 'gateway_route') return 'gateway_route';
    if (env['COPILOT_MODEL_GATEWAY_BINDING_SOURCE'] === 'gateway_profile') return 'gateway_profile';
    if (
        typeof env['COPILOT_MODEL_GATEWAY_PROVIDER_ID'] === 'string' &&
        env['COPILOT_MODEL_GATEWAY_PROVIDER_ID']?.trim()
    ) {
        return 'gateway_route';
    }
    if (createModelGatewayEnvProfileStore({ env }).getActive()) return 'gateway_profile';
    return 'env_compat';
}

/**
 * @param {string[]} refs
 * @param {string} providerId
 * @param {boolean} headersConfigured
 * @returns {{ apiKeyRefs: string[]; bearerTokenRefs: string[]; headersConfigured: boolean }}
 */
function classifySecretRefs(refs, providerId, headersConfigured) {
    const allowed = resolveModelGatewayProviderSecretRefs(providerId);
    return {
        apiKeyRefs: refs.filter((ref) => allowed.apiKeyRefs.includes(ref)),
        bearerTokenRefs: refs.filter((ref) => allowed.bearerTokenRefs.includes(ref)),
        headersConfigured,
    };
}

/**
 * @param {string} providerId
 * @param {ReturnType<typeof readConfiguredByokState>} state
 * @returns {Record<string, unknown>}
 */
function buildEnvCompatModelRouting(providerId, state) {
    const base = {
        tier: 'balanced',
        useCases: [],
        ...(state.summary.wireApi ? { wireApi: state.summary.wireApi } : {}),
    };
    if (providerId === 'ollama-local') {
        return {
            ...base,
            routeLayer: 'local_daemon',
            wireApi: 'openai_compatible',
            runtimeKind: 'local',
            localPrivate: true,
        };
    }
    if (providerId === 'ollama-cloud') {
        return {
            ...base,
            routeLayer: 'direct_provider',
            wireApi: 'openai_compatible',
            runtimeKind: 'cloud',
            localPrivate: false,
        };
    }
    return base;
}

/**
 * @param {unknown} modelInfo
 * @param {string} providerId
 * @param {ReturnType<typeof readConfiguredByokState>} state
 */
function modelInfoToRecord(modelInfo, providerId, state) {
    if (!modelInfo || typeof modelInfo !== 'object') return null;
    const record = /** @type {Record<string, unknown>} */ (modelInfo);
    const providerModel = typeof record['id'] === 'string' && record['id'].trim() ? record['id'].trim() : null;
    if (!providerModel) return null;
    const byok = isRecord(record['byok']) ? record['byok'] : {};
    const capabilities = isRecord(record['capabilities']) ? record['capabilities'] : {};
    const supports = isRecord(capabilities['supports']) ? capabilities['supports'] : {};
    const limits = isRecord(capabilities['limits']) ? capabilities['limits'] : {};
    const rateLimits = isRecord(byok['rateLimits']) ? byok['rateLimits'] : {};
    const pricing = isRecord(byok['pricing']) ? byok['pricing'] : {};
    const policy = isRecord(record['policy']) ? record['policy'] : {};
    return createModelRecord({
        id: buildProviderModelId(providerId, providerModel),
        providerId,
        providerModel,
        displayName: typeof record['name'] === 'string' ? record['name'] : providerModel,
        enabled: policy['state'] !== 'disabled',
        capabilities: {
            text: true,
            streaming: true,
            vision: Boolean(supports['vision'] ?? byok['supportsVision'] ?? state.summary.capabilities.vision),
            reasoningEffort: Boolean(
                supports['reasoningEffort'] ??
                byok['supportsReasoning'] ??
                state.summary.capabilities.sdkReasoningEffort,
            ),
            tools: Boolean(byok['tools'] ?? false),
        },
        limits: {
            contextWindowTokens:
                optionalPositiveInteger(limits['max_context_window_tokens']) ??
                optionalPositiveInteger(byok['contextWindowTokens']) ??
                state.summary.capabilities.contextWindowTokens,
            maxRequestTokens:
                optionalPositiveInteger(rateLimits['maxRequestTokens']) ?? state.summary.limits.maxRequestTokens,
            tokensPerMinute:
                optionalPositiveInteger(rateLimits['tokensPerMinute']) ?? state.summary.limits.tokensPerMinute,
            requestsPerMinute:
                optionalPositiveInteger(rateLimits['requestsPerMinute']) ?? state.summary.limits.requestsPerMinute,
            dailyRequests: optionalPositiveInteger(rateLimits['dailyRequests']) ?? state.summary.limits.dailyRequests,
        },
        pricing: {
            inputUsdPerMillion: optionalNonNegativeNumber(pricing['prompt']),
            outputUsdPerMillion: optionalNonNegativeNumber(pricing['completion']),
        },
        routing: buildEnvCompatModelRouting(providerId, state),
        verification: {
            confidence: byok['source'] === 'remote' ? 'catalog' : 'static_seed',
            sources: [byok['source'] === 'remote' ? 'provider_catalog' : 'env_compat'],
        },
        provenance: {
            source: 'env_compat',
            originalModelId: providerModel,
        },
    });
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function importConfiguredByokFromEnv(env = process.env) {
    const materialized = materializeModelGatewayActiveByokProfileEnv(env);
    const effectiveEnv = materialized.env;
    const state = readConfiguredByokState(effectiveEnv);
    const source = bindingSource(effectiveEnv);
    if (!state.enabled) {
        return {
            provider: null,
            models: [],
            active: {
                enabled: false,
                ready: false,
                providerId: null,
                modelId: null,
                providerModel: null,
                bindingSource: source,
            },
            warnings: [],
            errors: [],
        };
    }

    const providerId = resolveProviderId(state, effectiveEnv);
    const allowedSecretRefs = resolveModelGatewayProviderSecretRefs(providerId);
    const configuredSecretRefs = createEnvSecretRegistry({ env: effectiveEnv, keys: allowedSecretRefs.allowedRefs })
        .listConfigured()
        .map((entry) => entry.ref);
    const headersConfigured = state.summary.auth.headersConfigured;
    const provider = createProviderRecord({
        id: providerId,
        displayName: state.summary.preset ?? state.summary.providerType ?? providerId,
        providerType: state.summary.providerType ?? undefined,
        baseUrl: state.summary.baseUrl ?? undefined,
        wireApi: state.summary.wireApi ?? undefined,
        enabled: true,
        configured: state.ready,
        secretRefs: configuredSecretRefs,
        auth: classifySecretRefs(configuredSecretRefs, providerId, headersConfigured),
        headers: state.provider?.headers ?? {},
        provenance: {
            source,
            profile: state.summary.profile,
            gatewayProfile: effectiveEnv['COPILOT_MODEL_GATEWAY_PROVIDER_PROFILE'] ?? null,
            preset: state.summary.preset,
        },
    });

    const modelInfos = readConfiguredByokModelsFromEnv(effectiveEnv, {
        model: state.model,
        contextWindowTokens: state.summary.capabilities.contextWindowTokens,
        supportsReasoning: state.summary.capabilities.reasoningEffort,
        supportsVision: state.summary.capabilities.vision,
        ...state.summary.limits,
    });
    const activeProviderModel = state.model ?? state.summary.model ?? null;
    const models = modelInfos
        .map((model) => modelInfoToRecord(model, providerId, state))
        .filter((model) => model !== null);
    if (activeProviderModel && !models.some((model) => model.providerModel === activeProviderModel)) {
        const activeRecord = modelInfoToRecord(
            {
                id: activeProviderModel,
                name: activeProviderModel,
                byok: {
                    source: 'env_compat_active_model',
                    supportsReasoning: state.summary.capabilities.reasoningEffort,
                    supportsVision: state.summary.capabilities.vision,
                    contextWindowTokens: state.summary.capabilities.contextWindowTokens,
                    rateLimits: state.summary.limits,
                },
            },
            providerId,
            state,
        );
        if (activeRecord) models.unshift(activeRecord);
    }
    return {
        provider,
        models,
        active: {
            enabled: true,
            ready: state.ready,
            providerId,
            modelId: activeProviderModel ? buildProviderModelId(providerId, activeProviderModel) : null,
            providerModel: activeProviderModel,
            profile: state.summary.profile,
            gatewayProfile: effectiveEnv['COPILOT_MODEL_GATEWAY_PROVIDER_PROFILE'] ?? null,
            preset: state.summary.preset,
            bindingSource: source,
        },
        warnings: [...state.warnings],
        errors: [...state.errors],
    };
}
