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
import { resolveAgentRuntimeSelection } from './agent-runtime.js';
import { buildRuntimeLifecycleSummary, readRuntimeLifecycleSnapshot } from './runtime-lifecycle.js';
import { buildRuntimeRouteMetaFromSelection, buildRuntimeRouteMetaPayload } from './runtime-meta.js';

/** @typedef {import('./runtime-meta.js').RuntimeRouteMeta} RuntimeStatusMeta */
/**
 * @typedef {RuntimeStatusMeta & {
 *     agent: AlwaysAliveAgentLike;
 * }} RuntimeStatusRouteDeps
 */

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
 * Lê o snapshot do runtime selecionado sem expor a instância viva do agent para rotas de borda.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {Record<string, unknown> & {
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 * }}
 */
export function readAgentStatusSnapshotForRuntime(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return {
        ...readAgentStatusSnapshot(selection.runtime),
        ...buildRuntimeRouteMetaFromSelection(selection),
    };
}

/**
 * Retorna somente o status textual do runtime selecionado.
 *
 * @param {string | null | undefined} [runtimeId]
 * @returns {string}
 */
export function readAgentStatusValueForRuntime(runtimeId) {
    const selection = resolveAgentRuntimeSelection(runtimeId);
    return readAgentStatusValue(selection.runtime);
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
 * Projection HTTP-safe do endpoint /status a partir das deps runtime-aware da rota.
 *
 * @param {RuntimeStatusRouteDeps} deps
 * @returns {ReturnType<typeof buildAgentStatusHttpPayload>}
 */
export function buildAgentStatusHttpPayloadFromRoute(deps) {
    return buildAgentStatusHttpPayload(deps.agent, deps);
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
 * Projection HTTP-safe do endpoint /session a partir das deps runtime-aware da rota.
 *
 * @param {RuntimeStatusRouteDeps} deps
 * @returns {ReturnType<typeof buildAgentSessionHttpPayload>}
 */
export function buildAgentSessionHttpPayloadFromRoute(deps) {
    return buildAgentSessionHttpPayload(deps.agent, deps);
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

/**
 * Payload canônico do evento SSE `connected` a partir das deps runtime-aware da rota.
 *
 * @param {RuntimeStatusRouteDeps} deps
 * @returns {ReturnType<typeof buildAgentConnectedSsePayload>}
 */
export function buildAgentConnectedSsePayloadFromRoute(deps) {
    return buildAgentConnectedSsePayload(deps.agent, deps);
}
