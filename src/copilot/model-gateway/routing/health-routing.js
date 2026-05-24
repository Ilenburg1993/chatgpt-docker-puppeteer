// @ts-check
/**
 * Health-aware routing predicates for gateway model candidates.
 *
 * This module is intentionally independent from terminal rendering. It turns runtime-proved provider/model health into
 * routing facts that registry, policy engine and terminal UX can share.
 *
 * @module copilot/model-gateway/routing/health-routing
 */

import { listByokProviderModelHealth, readByokProviderModelHealth } from '../health/index.js';

/**
 * @param {{ lastStatus: 'failed' | 'ok' | null; lastFailureAt: number | null; lastSuccessAt: number | null }} health
 * @returns {boolean}
 */
export function isGatewayModelChatHealthFailed(health) {
    return health.lastStatus === 'failed' && (health.lastFailureAt ?? 0) >= (health.lastSuccessAt ?? 0);
}

/**
 * @param {{ agentProbeStatus?: 'failed' | 'ok' | null; lastAgentProbeFailureAt?: number | null; lastAgentProbeSuccessAt?: number | null }} health
 * @returns {boolean}
 */
export function isGatewayModelAgentProbeHealthFailed(health) {
    return (
        health.agentProbeStatus === 'failed' &&
        (health.lastAgentProbeFailureAt ?? 0) >= (health.lastAgentProbeSuccessAt ?? 0)
    );
}

/**
 * @param {{ agentProbeStatus?: 'failed' | 'ok' | null; lastAgentProbeFailureAt?: number | null; lastAgentProbeSuccessAt?: number | null }} health
 * @returns {boolean}
 */
export function isGatewayModelAgentProbeVerified(health) {
    return (
        health.agentProbeStatus === 'ok' &&
        (health.lastAgentProbeSuccessAt ?? 0) >= (health.lastAgentProbeFailureAt ?? 0)
    );
}

/**
 * @param {Record<string, any>} model
 * @param {{ routeProfile?: string | null }} [options]
 * @returns {ReturnType<typeof readByokProviderModelHealth>}
 */
export function readGatewayModelHealth(model, options = {}) {
    const providerId = typeof model['providerId'] === 'string' ? model['providerId'] : null;
    const providerModel = typeof model['providerModel'] === 'string' ? model['providerModel'] : null;
    const routeProfile = typeof options.routeProfile === 'string' && options.routeProfile.trim() ? options.routeProfile : null;
    const exact = readByokProviderModelHealth({ routeProfile, providerId, providerModel });
    if (exact) return exact;
    return (
        listByokProviderModelHealth().find(
            (health) =>
                health.providerId === providerId &&
                health.providerModel === providerModel &&
                (!routeProfile || health.routeProfile === routeProfile),
        ) ?? null
    );
}

/**
 * @param {Record<string, any>} model
 * @param {{ routeProfile?: string | null; excludeFailed?: boolean; requireAgentProbeOk?: boolean }} [options]
 * @returns {{ include: boolean; reason: string; health: ReturnType<typeof readGatewayModelHealth> }}
 */
export function evaluateGatewayModelHealthRoute(model, options = {}) {
    const health = readGatewayModelHealth(model, options);
    if (!health) {
        return {
            include: options.requireAgentProbeOk === true ? false : true,
            reason: options.requireAgentProbeOk === true ? 'agent_probe_missing' : 'health_unknown',
            health,
        };
    }
    if (options.excludeFailed !== false && isGatewayModelChatHealthFailed(health)) {
        return { include: false, reason: 'chat_health_failed', health };
    }
    if (options.excludeFailed !== false && isGatewayModelAgentProbeHealthFailed(health)) {
        return { include: false, reason: 'agent_probe_failed', health };
    }
    if (options.requireAgentProbeOk === true && !isGatewayModelAgentProbeVerified(health)) {
        return { include: false, reason: 'agent_probe_not_verified', health };
    }
    return { include: true, reason: 'health_allowed', health };
}

