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
import { buildProviderModelId, createModelRecord, createProviderRecord, normalizeGatewayIdPart } from '../contracts/records.js';
import { createEnvSecretRegistry } from '../secrets/env-secret-registry.js';

/**
 * @param {ReturnType<typeof readConfiguredByokState>} state
 * @returns {string}
 */
function resolveProviderId(state) {
    return normalizeGatewayIdPart(state.summary.preset ?? state.summary.providerType ?? 'byok-configured') || 'byok-configured';
}

/**
 * @param {string[]} refs
 * @returns {{ apiKeyRefs: string[]; bearerTokenRefs: string[]; headersConfigured: boolean }}
 */
function classifySecretRefs(refs) {
    const bearerTokenRefs = refs.filter((ref) => /BEARER|KILO/u.test(ref));
    const apiKeyRefs = refs.filter((ref) => !bearerTokenRefs.includes(ref));
    return {
        apiKeyRefs,
        bearerTokenRefs,
        headersConfigured: false,
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
 * @returns {object | null}
 */
function modelInfoToRecord(modelInfo, providerId, state) {
    if (!modelInfo || typeof modelInfo !== 'object') return null;
    const record = /** @type {Record<string, any>} */ (modelInfo);
    const providerModel = typeof record['id'] === 'string' && record['id'].trim() ? record['id'].trim() : null;
    if (!providerModel) return null;
    const byok = record['byok'] ?? {};
    const supports = record['capabilities']?.supports ?? {};
    const limits = record['capabilities']?.limits ?? {};
    return createModelRecord({
        id: buildProviderModelId(providerId, providerModel),
        providerId,
        providerModel,
        displayName: typeof record['name'] === 'string' ? record['name'] : providerModel,
        enabled: record['policy']?.state !== 'disabled',
        capabilities: {
            text: true,
            streaming: true,
            vision: Boolean(supports.vision ?? byok.supportsVision ?? state.summary.capabilities.vision),
            reasoningEffort: Boolean(
                supports.reasoningEffort ??
                    byok.supportsReasoning ??
                    state.summary.capabilities.sdkReasoningEffort,
            ),
            tools: Boolean(byok.tools ?? false),
        },
        limits: {
            contextWindowTokens:
                limits.max_context_window_tokens ??
                byok.contextWindowTokens ??
                state.summary.capabilities.contextWindowTokens,
            maxRequestTokens: byok.rateLimits?.maxRequestTokens ?? state.summary.limits.maxRequestTokens,
            tokensPerMinute: byok.rateLimits?.tokensPerMinute ?? state.summary.limits.tokensPerMinute,
            requestsPerMinute: byok.rateLimits?.requestsPerMinute ?? state.summary.limits.requestsPerMinute,
            dailyRequests: byok.rateLimits?.dailyRequests ?? state.summary.limits.dailyRequests,
        },
        pricing: {
            inputUsdPerMillion: byok.pricing?.prompt ?? undefined,
            outputUsdPerMillion: byok.pricing?.completion ?? undefined,
        },
        routing: buildEnvCompatModelRouting(providerId, state),
        verification: {
            confidence: byok.source === 'remote' ? 'catalog' : 'static_seed',
            sources: [byok.source === 'remote' ? 'provider_catalog' : 'env_compat'],
        },
        provenance: {
            source: 'env_compat',
            originalModelId: providerModel,
        },
    });
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ provider: object | null; models: object[]; active: object; warnings: string[]; errors: string[] }}
 */
export function importConfiguredByokFromEnv(env = process.env) {
    const state = readConfiguredByokState(env);
    if (!state.enabled) {
        return {
            provider: null,
            models: [],
            active: { enabled: false, ready: false, providerId: null, modelId: null, providerModel: null },
            warnings: [],
            errors: [],
        };
    }

    const providerId = resolveProviderId(state);
    const configuredSecretRefs = createEnvSecretRegistry({ env })
        .listConfigured()
        .map((entry) => entry.ref);
    const provider = createProviderRecord({
        id: providerId,
        displayName: state.summary.preset ?? state.summary.providerType ?? providerId,
        providerType: state.summary.providerType ?? undefined,
        baseUrl: state.summary.baseUrl ?? undefined,
        wireApi: state.summary.wireApi ?? undefined,
        enabled: true,
        configured: state.ready,
        secretRefs: configuredSecretRefs,
        auth: classifySecretRefs(configuredSecretRefs),
        headers: state.provider?.headers ?? {},
        provenance: {
            source: 'env_compat',
            profile: state.summary.profile,
            preset: state.summary.preset,
        },
    });

    const modelInfos = readConfiguredByokModelsFromEnv(env, {
        model: state.model,
        contextWindowTokens: state.summary.capabilities.contextWindowTokens,
        supportsReasoning: state.summary.capabilities.reasoningEffort,
        supportsVision: state.summary.capabilities.vision,
        ...state.summary.limits,
    });
    const models = modelInfos
        .map((model) => modelInfoToRecord(model, providerId, state))
        .filter((model) => model !== null);
    const activeProviderModel = state.model ?? state.summary.model ?? null;
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
            preset: state.summary.preset,
        },
        warnings: [...state.warnings],
        errors: [...state.errors],
    };
}
