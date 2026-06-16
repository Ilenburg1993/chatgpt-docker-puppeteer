// @ts-check
/**
 * Safe diagnostics for provider secret references.
 *
 * @module copilot/model-gateway/secrets/diagnostics
 */

import { createEnvSecretRegistry } from './env-secret-registry.js';
import { resolveModelGatewayProviderSecretRefs } from './requirements.js';

/**
 * @param {string} providerId
 * @param {{
 *     env?: Record<string, string | undefined>;
 *     configuredRefs?: readonly string[];
 * }} [options]
 */
export function diagnoseModelGatewayProviderSecretRefs(providerId, options = {}) {
    const requirements = resolveModelGatewayProviderSecretRefs(providerId);
    const registry = createEnvSecretRegistry({
        keys: requirements.allowedRefs,
        ...(options.env ? { env: options.env } : {}),
    });
    const configuredRefs = registry.listConfigured().map((item) => item.ref);
    const declaredRefs = [...new Set(options.configuredRefs ?? configuredRefs)];
    const invalidRefs = declaredRefs.filter((ref) => !requirements.allowedRefs.includes(ref));
    const configuredApiKeyRefs = configuredRefs.filter((ref) => requirements.apiKeyRefs.includes(ref));
    const configuredBearerTokenRefs = configuredRefs.filter((ref) => requirements.bearerTokenRefs.includes(ref));
    const ambiguousKinds = [
        ...(configuredApiKeyRefs.length > 1 ? ['api_key'] : []),
        ...(configuredBearerTokenRefs.length > 1 ? ['bearer_token'] : []),
    ];
    const missingKinds = [
        ...(configuredApiKeyRefs.length === 0 && configuredBearerTokenRefs.length === 0 ? ['authentication'] : []),
    ];
    return {
        schema: 'model-gateway-provider-secret-ref-diagnostic.v1',
        providerId,
        ready: invalidRefs.length === 0 && ambiguousKinds.length === 0 && missingKinds.length === 0,
        allowedRefs: requirements.allowedRefs,
        configuredRefs,
        configuredApiKeyRefs,
        configuredBearerTokenRefs,
        missingKinds,
        ambiguousKinds,
        invalidRefs,
    };
}
