// @ts-check
/**
 * Shared diagnostics for local/private provider opt-in.
 *
 * Local daemon providers are cataloged and routable, but default selection must
 * stay remote unless the operator explicitly asks for local execution.
 *
 * @module copilot/model-gateway/routing/local-provider-opt-in
 */

export const MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON = 'local_provider_requires_explicit_request';

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(optionalString).filter((item) => item !== null);
}

/**
 * @param {Record<string, any>} profile
 * @returns {boolean}
 */
function profileHasLocalProviderOptInBlock(profile) {
    return stringList(profile['topRejectedReasons']).includes(MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON);
}

/**
 * @param {{ profiles?: Array<Record<string, any>>; summary?: { rejectedReasonCounts?: Record<string, number> } }} selection
 * @returns {{ reason: string; blockedProfileIds: string[]; blockedProfileCount: number; rejectedCount: number; hasBlocks: boolean }}
 */
export function summarizeModelGatewayLocalProviderOptInBlocks(selection) {
    const blockedProfileIds = stringList(selection.profiles?.filter(profileHasLocalProviderOptInBlock).map((profile) => profile['profileId']));
    const rejectedCount = Number(selection.summary?.rejectedReasonCounts?.[MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON] ?? 0);
    return {
        reason: MODEL_GATEWAY_LOCAL_PROVIDER_EXPLICIT_REQUEST_REASON,
        blockedProfileIds,
        blockedProfileCount: blockedProfileIds.length,
        rejectedCount,
        hasBlocks: blockedProfileIds.length > 0 || rejectedCount > 0,
    };
}

/**
 * @param {{ profileId?: string | null; profileIds?: string[]; commandPrefix?: string }} [options]
 * @returns {string}
 */
export function renderModelGatewayLocalProviderOptInGuidance(options = {}) {
    const commandPrefix = options.commandPrefix ?? '/byok models route';
    const profileId = optionalString(options.profileId) ?? optionalString(options.profileIds?.[0]) ?? 'repo_agent';
    const profileSuffix = stringList(options.profileIds).length > 0 ? ` nos perfis ${stringList(options.profileIds).slice(0, 6).join(',')}` : '';
    return [
        `Ollama/local foi bloqueado por padrão${profileSuffix}.`,
        `Para usar modelos locais, peça explicitamente: ${commandPrefix} ${profileId} provider:ollama, ${commandPrefix} local_private ou ${commandPrefix} local_private_strict.`,
    ].join(' ');
}
