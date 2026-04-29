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
 * }} RuntimeRouteMeta
 */

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
 * }}
 */
export function buildRuntimeRouteMetaPayload(meta) {
    const runtimeMeta = normalizeRuntimeRouteMeta(meta);
    return {
        ...(runtimeMeta.runtimeId ? { runtimeId: runtimeMeta.runtimeId } : {}),
        ...(runtimeMeta.requestedRuntimeId !== undefined ? { requestedRuntimeId: runtimeMeta.requestedRuntimeId } : {}),
        ...(runtimeMeta.runtimeFound !== undefined ? { runtimeFound: runtimeMeta.runtimeFound } : {}),
        ...(runtimeMeta.usedDefaultRuntimeFallback !== undefined
            ? { usedDefaultRuntimeFallback: runtimeMeta.usedDefaultRuntimeFallback }
            : {}),
    };
}
