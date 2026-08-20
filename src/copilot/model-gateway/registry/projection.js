// @ts-check
/**
 * Operator-facing registry projections.
 *
 * @module copilot/model-gateway/registry/projection
 */

import {
    isGatewayModelAgentProbeHealthFailed,
    isGatewayModelChatHealthFailed,
    readGatewayModelHealth,
    summarizeGatewayRuntimeProofFreshness,
} from '../routing/index.js';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} model
 * @returns {string[]}
 */
function modelTags(model) {
    const capabilities = isRecord(model['capabilities']) ? model['capabilities'] : {};
    const limits = isRecord(model['limits']) ? model['limits'] : {};
    const verification = isRecord(model['verification']) ? model['verification'] : {};
    return [
        capabilities['streaming'] ? 'streaming' : null,
        capabilities['tools'] ? 'tools' : null,
        capabilities['vision'] ? 'vision' : null,
        capabilities['reasoningEffort'] ? 'reasoning' : null,
        typeof limits['contextWindowTokens'] === 'number' ? `ctx=${limits['contextWindowTokens']}` : null,
        typeof verification['confidence'] === 'string' ? `confidence=${verification['confidence']}` : null,
    ].filter((item) => item !== null);
}

/**
 * @param {Record<string, unknown>} model
 * @param {{ routeProfile?: string | null }} [options]
 * @returns {{
 *     source: 'runtime';
 *     chat: 'ok' | 'failed' | 'unknown';
 *     agent: 'ok' | 'failed' | 'unknown';
 *     proved: boolean;
 *     historicalProved: boolean;
 *     stale: boolean;
 *     proofAgeMs: number | null;
 *     proofMaxAgeMs: number;
 *     lastChatAt: number | null;
 *     lastAgentAt: number | null;
 * }}
 */
function modelRuntimeHealth(model, options = {}) {
    const health = readGatewayModelHealth(model, options);
    if (!health) {
        return {
            source: 'runtime',
            chat: 'unknown',
            agent: 'unknown',
            proved: false,
            historicalProved: false,
            stale: false,
            proofAgeMs: null,
            proofMaxAgeMs: 0,
            lastChatAt: null,
            lastAgentAt: null,
        };
    }
    const runtimeProof = summarizeGatewayRuntimeProofFreshness(health);
    const chat = isGatewayModelChatHealthFailed(health) ? 'failed' : runtimeProof.chatFresh ? 'ok' : 'unknown';
    const agent = isGatewayModelAgentProbeHealthFailed(health) ? 'failed' : runtimeProof.agentFresh ? 'ok' : 'unknown';
    return {
        source: 'runtime',
        chat,
        agent,
        proved: runtimeProof.hasFreshProof,
        historicalProved: runtimeProof.hasHistoricalProof,
        stale: runtimeProof.stale,
        proofAgeMs: runtimeProof.ageMs,
        proofMaxAgeMs: runtimeProof.maxAgeMs,
        lastChatAt: Math.max(health.lastFailureAt ?? 0, health.lastSuccessAt ?? 0) || null,
        lastAgentAt: Math.max(health.lastAgentProbeFailureAt ?? 0, health.lastAgentProbeSuccessAt ?? 0) || null,
    };
}

/**
 * @param {ReturnType<typeof modelRuntimeHealth>} runtime
 * @returns {string[]}
 */
function runtimeHealthTags(runtime) {
    return [
        `runtime.chat=${runtime.chat}`,
        `runtime.agent=${runtime.agent}`,
        runtime.proved ? 'runtime=proved' : runtime.stale ? 'runtime=stale' : 'runtime=unproved',
    ];
}

/**
 * @param {{ active?: Record<string, unknown>; source?: string }} snapshot
 * @returns {{
 *     enabled: boolean;
 *     ready: boolean;
 *     providerId: string | null;
 *     providerModel: string | null;
 *     modelId: string | null;
 *     profile: string | null;
 *     gatewayProfile: string | null;
 *     preset: string | null;
 *     bindingSource: string | null;
 *     source: string;
 *     label: string;
 * }}
 */
export function buildModelGatewayEffectiveRouteProjection(snapshot) {
    const active = isRecord(snapshot.active) ? snapshot.active : {};
    const providerId =
        typeof active['providerId'] === 'string' && active['providerId'].trim() ? active['providerId'] : null;
    const providerModel =
        typeof active['providerModel'] === 'string' && active['providerModel'].trim() ? active['providerModel'] : null;
    const modelId =
        typeof active['modelId'] === 'string' && active['modelId'].trim()
            ? active['modelId']
            : providerId && providerModel
              ? `${providerId}:${providerModel}`
              : null;
    const label = providerId && providerModel ? `${providerId} · ${providerModel}` : (providerModel ?? modelId ?? '-');
    return {
        enabled: active['enabled'] === true,
        ready: active['ready'] === true,
        providerId,
        providerModel,
        modelId,
        profile: typeof active['profile'] === 'string' && active['profile'].trim() ? active['profile'] : null,
        gatewayProfile:
            typeof active['gatewayProfile'] === 'string' && active['gatewayProfile'].trim()
                ? active['gatewayProfile']
                : null,
        preset: typeof active['preset'] === 'string' && active['preset'].trim() ? active['preset'] : null,
        bindingSource:
            typeof active['bindingSource'] === 'string' && active['bindingSource'].trim()
                ? active['bindingSource']
                : null,
        source: typeof snapshot.source === 'string' && snapshot.source.trim() ? snapshot.source : 'unknown',
        label,
    };
}

/**
 * @param {{
 *     providers: Record<string, unknown>[];
 *     models: Record<string, unknown>[];
 *     active?: Record<string, unknown>;
 *     source?: string;
 *     generatedAt?: string;
 * }} snapshot
 * @param {{
 *     routeProfile?: string | null;
 *     activeRoute?: Record<string, unknown> | null;
 * }} [options]
 * @returns {{
 *     source: string;
 *     generatedAt: string | null;
 *     active: Record<string, unknown>;
 *     providerCount: number;
 *     modelCount: number;
 *     enabledModelCount: number;
 *     effectiveRoute: ReturnType<typeof buildModelGatewayEffectiveRouteProjection>;
 *     providers: {
 *         id: string;
 *         displayName: string;
 *         configured: boolean;
 *         modelCount: number;
 *         baseUrl: string | null;
 *     }[];
 *     models: {
 *         id: string;
 *         providerId: string;
 *         providerModel: string;
 *         displayName: string;
 *         enabled: boolean;
 *         tags: string[];
 *         runtime: ReturnType<typeof modelRuntimeHealth>;
 *     }[];
 * }}
 */
export function buildModelGatewayOperatorProjection(snapshot, options = {}) {
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    const models = Array.isArray(snapshot.models) ? snapshot.models : [];
    const runtimeRoute = isRecord(options.activeRoute) ? options.activeRoute : null;
    const active =
        runtimeRoute &&
        typeof runtimeRoute['providerId'] === 'string' &&
        runtimeRoute['providerId'].trim() &&
        typeof runtimeRoute['providerModel'] === 'string' &&
        runtimeRoute['providerModel'].trim()
            ? {
                  ...(snapshot.active ?? {}),
                  ...runtimeRoute,
                  enabled: true,
                  ready: true,
                  modelId: `${runtimeRoute['providerId']}:${runtimeRoute['providerModel']}`,
                  bindingSource: 'runtime_state',
              }
            : (snapshot.active ?? {});
    const effectiveSnapshot = { ...snapshot, active };
    return {
        source: snapshot.source ?? 'unknown',
        generatedAt: snapshot.generatedAt ?? null,
        active,
        providerCount: providers.length,
        modelCount: models.length,
        enabledModelCount: models.filter((model) => model['enabled'] !== false).length,
        effectiveRoute: buildModelGatewayEffectiveRouteProjection(effectiveSnapshot),
        providers: providers.map((provider) => ({
            id: String(provider['id'] ?? ''),
            displayName: String(provider['displayName'] ?? provider['id'] ?? ''),
            configured: provider['configured'] === true,
            modelCount: models.filter((model) => model['providerId'] === provider['id']).length,
            baseUrl: typeof provider['baseUrl'] === 'string' ? provider['baseUrl'] : null,
        })),
        models: models.map((model) => {
            const runtime = modelRuntimeHealth(model, options);
            return {
                id: String(model['id'] ?? ''),
                providerId: String(model['providerId'] ?? ''),
                providerModel: String(model['providerModel'] ?? ''),
                displayName: String(model['displayName'] ?? model['providerModel'] ?? model['id'] ?? ''),
                enabled: model['enabled'] !== false,
                tags: [...modelTags(model), ...runtimeHealthTags(runtime)],
                runtime,
            };
        }),
    };
}
