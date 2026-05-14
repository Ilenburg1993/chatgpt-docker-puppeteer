// @ts-check
/**
 * @module copilot/presentation/runtime-capabilities
 * @file Projection HTTP-safe das capabilities públicas do runtime do agent.
 *
 *   A leitura semântica nasce em `agent/facades/agent-runtime-capabilities.js`; esta camada adiciona metadata de seleção
 *   de runtime e estabiliza o shape compartilhado por server, terminal e futuras bordas.
 */

import { readAgentRuntimeCapabilities } from '#copilot/agent/facades';
import { buildRuntimeRouteMetaPayload } from '../routing/index.js';
import { getAgentHealthSnapshotCompat } from './health.js';

/**
 * @typedef {import('#copilot/agent/types').IAlwaysAliveAgent & {
 *     listWebhooks?: () => unknown[];
 *     getHandoffManager?: () => unknown;
 * }} CapabilityAgent
 */

/** @typedef {import('../routing/index.js').RuntimeRouteMeta} RuntimeCapabilitiesMeta */
/** @typedef {RuntimeCapabilitiesMeta & { agent: CapabilityAgent }} RuntimeCapabilitiesRouteDeps */

/**
 * Payload estável para bordas.
 *
 * A camada `agent/facades` decide quais capabilities existem e qual é o readiness delas. A camada `presentation`
 * acrescenta somente envelope comum de borda: `ok`, timestamp e metadata de seleção/fallback do runtime.
 *
 * @typedef {ReturnType<typeof readAgentRuntimeCapabilities> & {
 *     ok: true;
 *     generatedAt: number;
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }} RuntimeCapabilitiesPayload
 */

/**
 * Monta a projection de capabilities para consumidores de borda.
 *
 * Não adicione decisão operacional aqui. Se uma capability nova precisar de readiness real, a origem correta é
 * `agent/facades/agent-runtime-capabilities.js` ou um port/facade específico do domínio.
 *
 * @param {CapabilityAgent} agent
 * @param {RuntimeCapabilitiesMeta | string | null | undefined} [meta]
 * @returns {RuntimeCapabilitiesPayload}
 */
export function buildAgentRuntimeCapabilities(agent, meta) {
    return {
        ok: true,
        generatedAt: Date.now(),
        ...buildRuntimeRouteMetaPayload(meta),
        ...readAgentRuntimeCapabilities(agent, { healthSnapshot: getAgentHealthSnapshotCompat(agent) }),
    };
}

/**
 * Monta a projection de capabilities a partir das deps runtime-aware da rota.
 *
 * @param {RuntimeCapabilitiesRouteDeps} deps
 * @returns {RuntimeCapabilitiesPayload}
 */
export function buildAgentRuntimeCapabilitiesFromRoute(deps) {
    return buildAgentRuntimeCapabilities(deps.agent, deps);
}
