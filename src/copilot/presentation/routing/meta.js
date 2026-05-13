// @ts-check
/**
 * @module copilot/presentation/runtime-meta
 * @file Helpers compartilhados para metadata de seleção/fallback do runtime em payloads de borda.
 */

/**
 * @typedef {{
 *     runtimeId?: string | null;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 *     runtimeFallbackWarning?: string | null;
 * }} RuntimeRouteMeta
 *
 *
 * @typedef {{
 *     runtimeId: string;
 *     requestedRuntimeId: string | null;
 *     runtimeFound: boolean;
 *     usedDefaultRuntimeFallback: boolean;
 *     runtimeFallbackWarning?: string | null;
 * }} RuntimeRouteSelectionMeta
 */

/**
 * @param {RuntimeRouteMeta | string | null | undefined} meta
 * @returns {string | null}
 */
export function buildRuntimeFallbackWarning(meta) {
    const runtimeMeta = normalizeRuntimeRouteMeta(meta);
    if (!runtimeMeta.usedDefaultRuntimeFallback) return null;
    const requested = runtimeMeta.requestedRuntimeId;
    const runtimeId = runtimeMeta.runtimeId;
    if (typeof requested !== 'string' || requested.trim().length === 0) return null;
    if (typeof runtimeId !== 'string' || runtimeId.trim().length === 0) {
        return `Runtime '${requested}' não encontrado; fallback para runtime default.`;
    }
    return `Runtime '${requested}' não encontrado; fallback para '${runtimeId}'.`;
}

/**
 * Normaliza metadata antiga (`runtimeId` string) e metadata estruturada (`RuntimeRouteMeta`).
 *
 * @param {RuntimeRouteMeta | string | null | undefined} meta
 * @returns {RuntimeRouteMeta}
 */
export function normalizeRuntimeRouteMeta(meta) {
    if (!meta) return {};
    if (typeof meta === 'string') {
        return { runtimeId: meta };
    }
    return meta;
}

/**
 * Projeta apenas os campos de metadata definidos para anexar em payloads HTTP/SSE.
 *
 * @param {RuntimeRouteMeta | string | null | undefined} meta
 * @returns {{
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 *     runtimeFallbackWarning?: string | null;
 * }}
 */
export function buildRuntimeRouteMetaPayload(meta) {
    const runtimeMeta = normalizeRuntimeRouteMeta(meta);
    const runtimeFallbackWarning = buildRuntimeFallbackWarning(runtimeMeta);
    return {
        ...(runtimeMeta.runtimeId ? { runtimeId: runtimeMeta.runtimeId } : {}),
        ...(runtimeMeta.requestedRuntimeId !== undefined ? { requestedRuntimeId: runtimeMeta.requestedRuntimeId } : {}),
        ...(runtimeMeta.runtimeFound !== undefined ? { runtimeFound: runtimeMeta.runtimeFound } : {}),
        ...(runtimeMeta.usedDefaultRuntimeFallback !== undefined
            ? { usedDefaultRuntimeFallback: runtimeMeta.usedDefaultRuntimeFallback }
            : {}),
        ...(runtimeFallbackWarning !== null ? { runtimeFallbackWarning } : {}),
    };
}

/**
 * Converte seleções de runtime vindas de `resolveAgentRuntimeSelection()` em metadata de borda.
 *
 * Mantém `presentation/*` com um único shape de runtime targeting/fallback e evita que cada projection copie os mesmos
 * quatro campos manualmente.
 *
 * @param {RuntimeRouteSelectionMeta} selection
 * @returns {RuntimeRouteSelectionMeta}
 */
export function buildRuntimeRouteMetaFromSelection(selection) {
    const runtimeFallbackWarning = buildRuntimeFallbackWarning(selection);
    return {
        runtimeId: selection.runtimeId,
        requestedRuntimeId: selection.requestedRuntimeId,
        runtimeFound: selection.runtimeFound,
        usedDefaultRuntimeFallback: selection.usedDefaultRuntimeFallback,
        runtimeFallbackWarning,
    };
}

/**
 * Projeta metadata canônica para cenários em que um `runtimeId` explícito foi pedido mas não existe.
 *
 * Não informa `runtimeId` efetivo nem fallback, porque a operação deve falhar de forma estrita nessas superfícies.
 *
 * @param {string | null | undefined} requestedRuntimeId
 * @returns {{ requestedRuntimeId?: string | null; runtimeFound?: boolean; usedDefaultRuntimeFallback?: boolean }}
 */
export function buildMissingRuntimeRouteMeta(requestedRuntimeId) {
    if (typeof requestedRuntimeId !== 'string' || requestedRuntimeId.trim().length === 0) {
        return {};
    }
    return {
        requestedRuntimeId: requestedRuntimeId.trim(),
        runtimeFound: false,
        usedDefaultRuntimeFallback: false,
    };
}
