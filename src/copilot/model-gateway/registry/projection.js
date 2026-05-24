// @ts-check
/**
 * Operator-facing registry projections.
 *
 * @module copilot/model-gateway/registry/projection
 */

/**
 * @param {Record<string, any>} model
 * @returns {string[]}
 */
function modelTags(model) {
    const capabilities = model['capabilities'] ?? {};
    const limits = model['limits'] ?? {};
    return [
        capabilities['streaming'] ? 'streaming' : null,
        capabilities['tools'] ? 'tools' : null,
        capabilities['vision'] ? 'vision' : null,
        capabilities['reasoningEffort'] ? 'reasoning' : null,
        typeof limits['contextWindowTokens'] === 'number' ? `ctx=${limits['contextWindowTokens']}` : null,
        model['verification']?.confidence ? `confidence=${model['verification'].confidence}` : null,
    ].filter((item) => item !== null);
}

/**
 * @param {{ providers: Record<string, any>[]; models: Record<string, any>[]; active?: Record<string, any>; source?: string; generatedAt?: string }} snapshot
 * @returns {{
 *     source: string;
 *     generatedAt: string | null;
 *     active: Record<string, any>;
 *     providerCount: number;
 *     modelCount: number;
 *     enabledModelCount: number;
 *     providers: Array<{ id: string; displayName: string; configured: boolean; modelCount: number; baseUrl: string | null }>;
 *     models: Array<{ id: string; providerId: string; providerModel: string; displayName: string; enabled: boolean; tags: string[] }>;
 * }}
 */
export function buildModelGatewayOperatorProjection(snapshot) {
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    const models = Array.isArray(snapshot.models) ? snapshot.models : [];
    return {
        source: snapshot.source ?? 'unknown',
        generatedAt: snapshot.generatedAt ?? null,
        active: snapshot.active ?? {},
        providerCount: providers.length,
        modelCount: models.length,
        enabledModelCount: models.filter((model) => model['enabled'] !== false).length,
        providers: providers.map((provider) => ({
            id: String(provider['id'] ?? ''),
            displayName: String(provider['displayName'] ?? provider['id'] ?? ''),
            configured: provider['configured'] === true,
            modelCount: models.filter((model) => model['providerId'] === provider['id']).length,
            baseUrl: typeof provider['baseUrl'] === 'string' ? provider['baseUrl'] : null,
        })),
        models: models.map((model) => ({
            id: String(model['id'] ?? ''),
            providerId: String(model['providerId'] ?? ''),
            providerModel: String(model['providerModel'] ?? ''),
            displayName: String(model['displayName'] ?? model['providerModel'] ?? model['id'] ?? ''),
            enabled: model['enabled'] !== false,
            tags: modelTags(model),
        })),
    };
}

