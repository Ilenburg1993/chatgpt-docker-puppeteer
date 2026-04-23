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

/**
 * Metadata de seleção do runtime.
 *
 * Esses campos acompanham endpoints de status/session para que clientes consigam distinguir "runtime pedido" de
 * "runtime usado após fallback".
 *
 * @typedef {{
 *     runtimeId?: string | null;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }} RuntimeStatusMeta
 */

/**
 * Normaliza metadata antiga (`runtimeId` string) e metadata nova (`RuntimeRouteDeps`).
 *
 * @param {string | null | undefined | RuntimeStatusMeta} meta
 * @returns {RuntimeStatusMeta}
 */
function normalizeRuntimeStatusMeta(meta) {
    if (!meta) return {};
    if (typeof meta === 'string') {
        return { runtimeId: meta };
    }
    return meta;
}

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
    const runtimeMeta = normalizeRuntimeStatusMeta(meta);
    return {
        ok: true,
        ...(runtimeMeta.runtimeId ? { runtimeId: runtimeMeta.runtimeId } : {}),
        ...(runtimeMeta.requestedRuntimeId !== undefined ? { requestedRuntimeId: runtimeMeta.requestedRuntimeId } : {}),
        ...(runtimeMeta.runtimeFound !== undefined ? { runtimeFound: runtimeMeta.runtimeFound } : {}),
        ...(runtimeMeta.usedDefaultRuntimeFallback !== undefined
            ? { usedDefaultRuntimeFallback: runtimeMeta.usedDefaultRuntimeFallback }
            : {}),
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
    const runtimeMeta = normalizeRuntimeStatusMeta(meta);
    return {
        ok: true,
        ...(runtimeMeta.runtimeId ? { runtimeId: runtimeMeta.runtimeId } : {}),
        ...(runtimeMeta.requestedRuntimeId !== undefined ? { requestedRuntimeId: runtimeMeta.requestedRuntimeId } : {}),
        ...(runtimeMeta.runtimeFound !== undefined ? { runtimeFound: runtimeMeta.runtimeFound } : {}),
        ...(runtimeMeta.usedDefaultRuntimeFallback !== undefined
            ? { usedDefaultRuntimeFallback: runtimeMeta.usedDefaultRuntimeFallback }
            : {}),
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
    const runtimeMeta = normalizeRuntimeStatusMeta(meta);
    return {
        ...(runtimeMeta.runtimeId ? { runtimeId: runtimeMeta.runtimeId } : {}),
        ...(runtimeMeta.requestedRuntimeId !== undefined ? { requestedRuntimeId: runtimeMeta.requestedRuntimeId } : {}),
        ...(runtimeMeta.runtimeFound !== undefined ? { runtimeFound: runtimeMeta.runtimeFound } : {}),
        ...(runtimeMeta.usedDefaultRuntimeFallback !== undefined
            ? { usedDefaultRuntimeFallback: runtimeMeta.usedDefaultRuntimeFallback }
            : {}),
        ...readAgentStatusSnapshot(agent),
        timestamp: Date.now(),
    };
}
