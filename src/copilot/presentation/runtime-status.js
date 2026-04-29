// @ts-check
/**
 * @module copilot/presentation/runtime-status
 * @file Projeções compartilhadas de status/session/stream do runtime do agent.
 *
 *   Esta camada evita que rotas HTTP e canais SSE remontem snapshots do agent manualmente em cada arquivo.
 *
 *   A semântica bruta de runtime vem de `agent/facades/agent-runtime-status.js`; esta projection só adiciona envelope de
 *   borda (`ok`, runtime metadata, campos HTTP-safe) e shapes compartilhados entre REST/SSE.
 */

/**
 * Runtime compatível com as projections de status.
 *
 * @typedef {import('../agent/types.js').IAlwaysAliveAgent} AlwaysAliveAgentLike
 */

import { readAgentRuntimeStatusSnapshot, readAgentRuntimeStatusValue } from '#copilot/agent';
import { buildRuntimeLifecycleSummary, readRuntimeLifecycleSnapshot } from './runtime-lifecycle.js';
import { buildRuntimeRouteMetaPayload } from './runtime-meta.js';

/** @typedef {import('./runtime-meta.js').RuntimeRouteMeta} RuntimeStatusMeta */

/**
 * Lê o snapshot bruto do agent em formato seguro para projections compartilhadas.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {Record<string, unknown>}
 */
export function readAgentStatusSnapshot(agent) {
    return readAgentRuntimeStatusSnapshot(agent);
}

/**
 * Retorna o status textual do runtime a partir do snapshot.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @returns {string}
 */
export function readAgentStatusValue(agent) {
    return readAgentRuntimeStatusValue(agent);
}

/**
 * Projection HTTP-safe do endpoint /status do runtime.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @param {string | null | undefined | RuntimeStatusMeta} [meta]
 * @returns {Record<string, unknown> & {
 *     ok: true;
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
export function buildAgentStatusHttpPayload(agent, meta) {
    const lifecycle = readRuntimeLifecycleSnapshot();
    return {
        ok: true,
        ...buildRuntimeRouteMetaPayload(meta),
        lifecycle,
        lifecycleSummary: buildRuntimeLifecycleSummary(lifecycle),
        ...readAgentStatusSnapshot(agent),
    };
}

/**
 * Projection HTTP-safe do endpoint /session do runtime.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @param {string | null | undefined | RuntimeStatusMeta} [meta]
 * @returns {{
 *     ok: true;
 *     sessionId: string | null;
 *     model: string | null;
 *     isResumed: boolean;
 *     resumeCount: number;
 *     sendCount: number;
 *     startedAt: number | null;
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
export function buildAgentSessionHttpPayload(agent, meta) {
    const snap = readAgentStatusSnapshot(agent);
    return {
        ok: true,
        ...buildRuntimeRouteMetaPayload(meta),
        sessionId: typeof snap['sessionId'] === 'string' ? snap['sessionId'] : null,
        model: typeof snap['model'] === 'string' ? snap['model'] : null,
        isResumed: Boolean(snap['isResumed']),
        resumeCount: Number(snap['resumeCount'] ?? 0),
        sendCount: Number(snap['sendCount'] ?? 0),
        startedAt: typeof snap['startedAt'] === 'number' ? snap['startedAt'] : null,
    };
}

/**
 * Payload canônico do evento SSE `connected` do runtime.
 *
 * @param {AlwaysAliveAgentLike} agent
 * @param {string | null | undefined | RuntimeStatusMeta} [meta]
 * @returns {Record<string, unknown> & {
 *     timestamp: number;
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
export function buildAgentConnectedSsePayload(agent, meta) {
    return {
        ...buildRuntimeRouteMetaPayload(meta),
        ...readAgentStatusSnapshot(agent),
        timestamp: Date.now(),
    };
}
