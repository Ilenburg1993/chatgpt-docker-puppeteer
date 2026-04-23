// @ts-check
/**
 * @module copilot/presentation/runtime-capabilities
 * @file Projection HTTP-safe das capabilities públicas do runtime do agent.
 *
 *   A leitura semântica nasce em `agent/facades/agent-runtime-capabilities.js`; esta camada adiciona metadata de seleção
 *   de runtime e estabiliza o shape compartilhado por server, terminal e futuras bordas.
 */

import { readAgentRuntimeCapabilities } from '#copilot/agent';
import { getAgentHealthSnapshotCompat } from './runtime-health.js';

/**
 * @typedef {import('../agent/types.js').IAlwaysAliveAgent & {
 *     listWebhooks?: () => unknown[];
 *     getHandoffManager?: () => unknown;
 * }} CapabilityAgent
 */

/**
 * @typedef {{
 *     runtimeId?: string | null;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }} RuntimeCapabilitiesMeta
 */

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
 * Normaliza metadata recebida de rotas antigas (`string`) e rotas novas (`RuntimeRouteDeps`).
 *
 * @param {RuntimeCapabilitiesMeta | string | null | undefined} meta
 * @returns {RuntimeCapabilitiesMeta}
 */
function normalizeMeta(meta) {
    if (!meta) return {};
    if (typeof meta === 'string') return { runtimeId: meta };
    return meta;
}

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
    const runtimeMeta = normalizeMeta(meta);
    return {
        ok: true,
        generatedAt: Date.now(),
        ...(runtimeMeta.runtimeId ? { runtimeId: runtimeMeta.runtimeId } : {}),
        ...(runtimeMeta.requestedRuntimeId !== undefined ? { requestedRuntimeId: runtimeMeta.requestedRuntimeId } : {}),
        ...(runtimeMeta.runtimeFound !== undefined ? { runtimeFound: runtimeMeta.runtimeFound } : {}),
        ...(runtimeMeta.usedDefaultRuntimeFallback !== undefined
            ? { usedDefaultRuntimeFallback: runtimeMeta.usedDefaultRuntimeFallback }
            : {}),
        ...readAgentRuntimeCapabilities(agent, { healthSnapshot: getAgentHealthSnapshotCompat(agent) }),
    };
}
