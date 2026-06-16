// @ts-check
/**
 * Gateway-owned session binding projection.
 *
 * The current env BYOK implementation remains the compatibility source while providers migrate into the gateway. This
 * bridge makes provider adapters authoritative for the SDK-facing provider/model projection and keeps the compatibility
 * resolver responsible for its mature validation and summary contract.
 *
 * @module copilot/model-gateway/session/session-binding
 */

import { resolveConfiguredByokSessionOverrides as resolveLegacyByokSessionOverrides } from '#copilot/sdk/session';
import { createModelGatewayModelIdentity } from '../contracts/model-identity.js';
import { resolveModelGatewayProviderAdapter } from '../providers/provider-adapter-registry.js';
import { materializeModelGatewayActiveByokProfileEnv } from '../profiles/env-profile-store.js';
import { importConfiguredByokFromEnv } from '../registry/env-byok-compat-importer.js';
import { createEnvSecretRegistry } from '../secrets/env-secret-registry.js';
import { resolveModelGatewayProviderSecretRefs } from '../secrets/requirements.js';
import { assertModelGatewaySecretRegistryPort } from '../control-plane/ports.js';

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function record(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, any>} */ (value) : {};
}

/**
 * @param {Record<string, any>} adaptedProvider
 * @param {Record<string, any>} legacyProvider
 * @returns {Record<string, any>}
 */
function mergeCompatibilityProviderDetails(adaptedProvider, legacyProvider) {
    const adaptedHeaders = record(adaptedProvider['headers']);
    const legacyHeaders = record(legacyProvider['headers']);
    return {
        ...adaptedProvider,
        ...(legacyProvider['azure'] ? { azure: legacyProvider['azure'] } : {}),
        ...(Object.keys(adaptedHeaders).length > 0 || Object.keys(legacyHeaders).length > 0
            ? { headers: { ...adaptedHeaders, ...legacyHeaders } }
            : {}),
    };
}

/**
 * Resolves a gateway-owned binding for SDK session creation/resume.
 *
 * This function is synchronous because the existing session initialization path is synchronous up to the SDK lifecycle
 * effect. The persisted catalog remains the source for discovery/routing; the active env profile is the compatibility
 * source for secret-bearing session binding until a dedicated secret-backed profile store exists.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string | undefined} [requestedModel]
 * @returns {ReturnType<typeof resolveLegacyByokSessionOverrides> & {
 *     gatewayBinding?: {
 *         schemaVersion: 1;
 *         source: 'gateway_route' | 'gateway_profile' | 'env_compat';
 *         providerId: string;
 *         modelId: string;
 *         providerModel: string;
 *         adapterId: string;
 *         identity: ReturnType<typeof createModelGatewayModelIdentity>;
 *     };
 * }}
 */
export function resolveModelGatewaySessionBinding(env = process.env, requestedModel = undefined) {
    const materialized = materializeModelGatewayActiveByokProfileEnv(env);
    const effectiveEnv = materialized.env;
    const legacy = resolveLegacyByokSessionOverrides(effectiveEnv, requestedModel);
    if (!legacy.enabled || !legacy.ready || !legacy.provider || !legacy.model) return legacy;

    const imported = importConfiguredByokFromEnv(effectiveEnv);
    const provider = record(imported.provider);
    const providerId = typeof provider['id'] === 'string' ? provider['id'] : null;
    if (!providerId) {
        throw new Error('[model-gateway/session-binding] active BYOK provider has no canonical provider id');
    }
    const model = imported.models.find((candidate) => record(candidate)['providerModel'] === legacy.model);
    if (!model) {
        throw new Error(
            `[model-gateway/session-binding] model '${legacy.model}' is not bound to active provider '${providerId}'`,
        );
    }

    const adapter = resolveModelGatewayProviderAdapter(provider);
    const secretRefs = resolveModelGatewayProviderSecretRefs(providerId);
    const secrets = assertModelGatewaySecretRegistryPort(
        createEnvSecretRegistry({ env: effectiveEnv, keys: secretRefs.allowedRefs }),
    );
    const adapted = adapter['toCopilotSessionOverrides']({
        provider,
        model,
        secrets,
    });
    const adaptedProvider = record(adapted['provider']);
    const legacyProvider = record(legacy.provider);
    const modelId = typeof record(model)['id'] === 'string' ? record(model)['id'] : `${providerId}:${legacy.model}`;
    const adapterId = typeof adapter['id'] === 'string' ? adapter['id'] : 'openai-compatible';
    const adaptedCapabilities = record(adapted['modelCapabilities']);
    const supports = record(adaptedCapabilities['supports']);
    const active = record(imported.active);
    const bindingSource =
        active['bindingSource'] === 'gateway_route' || active['bindingSource'] === 'gateway_profile'
            ? active['bindingSource']
            : 'env_compat';
    const identity = createModelGatewayModelIdentity({
        providerId,
        providerModel: adapted['model'],
        providerProfile: active['gatewayProfile'] ?? active['profile'] ?? active['preset'] ?? null,
    });

    return {
        ...legacy,
        provider: /** @type {import('#copilot/sdk/types').ProviderConfig} */ (
            mergeCompatibilityProviderDetails(adaptedProvider, legacyProvider)
        ),
        model: adapted['model'],
        modelCapabilities:
            Object.keys(adaptedCapabilities).length > 0 ? adaptedCapabilities : legacy.modelCapabilities,
        supportsReasoning: Boolean(supports['reasoningEffort']),
        summary: {
            ...legacy.summary,
            model: adapted['model'],
            capabilities: {
                ...legacy.summary.capabilities,
                sdkReasoningEffort: Boolean(supports['reasoningEffort']),
            },
        },
        gatewayBinding: {
            schemaVersion: 1,
            source: bindingSource,
            providerId,
            modelId,
            providerModel: adapted['model'],
            adapterId,
            identity,
        },
    };
}
