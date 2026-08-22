// @ts-check
/**
 * Conservative admission policy for disposable Model Gateway probes.
 *
 * @module copilot/model-gateway/probes/admission
 */

import { utf8ByteLength } from '#copilot/infra/public/platform/buffer';

export const MODEL_GATEWAY_PROBE_LOW_REQUEST_TOKEN_LIMIT = 8_000;
export const MODEL_GATEWAY_PROBE_RESPONSE_RESERVE_TOKENS = 1_024;
export const MODEL_GATEWAY_PROBE_REQUEST_FLOOR_TOKENS = 16_384;

/**
 * @param {string} message
 * @returns {number}
 */
function estimateMessageTokens(message) {
    return Math.ceil(utf8ByteLength(message, 'model gateway probe budget estimate') / 4);
}

/**
 * @param {ReturnType<typeof import('#copilot/sdk/session').readConfiguredByokState>['summary']} byok
 * @param {'chat' | 'agent'} mode
 * @param {string} prompt
 */
export function evaluateModelGatewayProbeAdmission(byok, mode, prompt) {
    const limits = byok.limits;
    const limit =
        typeof limits.maxRequestTokens === 'number'
            ? limits.maxRequestTokens
            : typeof limits.tokensPerMinute === 'number'
              ? limits.tokensPerMinute
              : null;
    const estimatedRequestTokens = Math.max(
        MODEL_GATEWAY_PROBE_REQUEST_FLOOR_TOKENS,
        estimateMessageTokens(prompt) + MODEL_GATEWAY_PROBE_RESPONSE_RESERVE_TOKENS,
    );
    if (byok.enabled !== true || byok.ready !== true || limit === null) {
        return {
            shouldWarn: false,
            shouldBlock: false,
            severity: 'none',
            label: 'sem limite BYOK declarado',
            estimatedRequestTokens,
            limit,
            utilization: null,
        };
    }
    if (estimatedRequestTokens > limit || limit < MODEL_GATEWAY_PROBE_LOW_REQUEST_TOKEN_LIMIT) {
        return {
            shouldWarn: true,
            shouldBlock: true,
            severity: 'block',
            label:
                `probe ${mode} estimado em ${estimatedRequestTokens} tokens > limite BYOK ${limit}; ` +
                `o envelope SDK precisa de headroom >= ${MODEL_GATEWAY_PROBE_REQUEST_FLOOR_TOKENS} tokens`,
            estimatedRequestTokens,
            limit,
            utilization: null,
        };
    }
    if (estimatedRequestTokens > limit * 0.85) {
        return {
            shouldWarn: true,
            shouldBlock: false,
            severity: 'warn',
            label: `probe ${mode} estimado em ${estimatedRequestTokens}/${limit} tokens; margem BYOK estreita`,
            estimatedRequestTokens,
            limit,
            utilization: null,
        };
    }
    return {
        shouldWarn: false,
        shouldBlock: false,
        severity: 'none',
        label: 'orçamento BYOK suficiente para o probe',
        estimatedRequestTokens,
        limit,
        utilization: null,
    };
}
