// @ts-check
/**
 * src/copilot/config/hub-timeout-policy.js
 *
 * Política canônica de timeout para envios ao ConversationHub.
 *
 * @module copilot/config/hub-timeout-policy
 */

/** @type {number} */
export const HUB_TURN_TIMEOUT_MIN_MS = 5_000;
/** @type {number} */
export const HUB_TURN_TIMEOUT_MAX_MS = 24 * 60 * 60_000;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * @param {number} value
 * @returns {number}
 */
function roundToSecond(value) {
    return Math.ceil(value / 1000) * 1000;
}

/**
 * @typedef {{
 *     defaultTimeoutMs: number;
 *     explicitTimeoutMs?: number | null;
 *     payloadChars?: number;
 *     useStructured?: boolean;
 *     priority?: 'low' | 'medium' | 'high' | 'critical';
 *     responseType?: string | undefined;
 * }} HubTimeoutContext
 */

/**
 * @typedef {{ timeoutMs: number | null; strategy: 'explicit' | 'adaptive' | 'watchdog_only'; reasons: string[] }} HubTimeoutDecision
 */

/**
 * Resolve timeout semântico para `hub.sendToLlmB`.
 *
 * @param {HubTimeoutContext} ctx
 * @returns {HubTimeoutDecision}
 */
export function resolveHubTurnTimeout(ctx) {
    const explicitTimeoutMs = ctx.explicitTimeoutMs;

    if (explicitTimeoutMs === 0 || explicitTimeoutMs === null) {
        return {
            timeoutMs: null,
            strategy: 'watchdog_only',
            reasons: ['caller_disabled'],
        };
    }

    if (typeof explicitTimeoutMs === 'number' && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
        return {
            timeoutMs: roundToSecond(clamp(explicitTimeoutMs, HUB_TURN_TIMEOUT_MIN_MS, HUB_TURN_TIMEOUT_MAX_MS)),
            strategy: 'explicit',
            reasons: ['caller'],
        };
    }

    const reasons = ['baseline'];
    let computedMs = Math.max(HUB_TURN_TIMEOUT_MIN_MS, ctx.defaultTimeoutMs);

    const payloadChars = Math.max(0, Math.floor(ctx.payloadChars ?? 0));
    if (payloadChars >= 24_000) {
        computedMs *= 2.2;
        reasons.push('payload_xlarge');
    } else if (payloadChars >= 12_000) {
        computedMs *= 1.8;
        reasons.push('payload_large');
    } else if (payloadChars >= 6_000) {
        computedMs *= 1.45;
        reasons.push('payload_medium');
    } else if (payloadChars >= 2_000) {
        computedMs *= 1.2;
        reasons.push('payload_small_boost');
    }

    if (ctx.useStructured) {
        computedMs *= 1.2;
        reasons.push('structured_mode');
    }

    if (ctx.responseType === 'plan' || ctx.responseType === 'code') {
        computedMs *= 1.25;
        reasons.push('response_heavy');
    }

    if (ctx.priority === 'high' || ctx.priority === 'critical') {
        computedMs *= 1.1;
        reasons.push('priority_guard');
    }

    return {
        timeoutMs: roundToSecond(clamp(computedMs, HUB_TURN_TIMEOUT_MIN_MS, HUB_TURN_TIMEOUT_MAX_MS)),
        strategy: 'adaptive',
        reasons,
    };
}
