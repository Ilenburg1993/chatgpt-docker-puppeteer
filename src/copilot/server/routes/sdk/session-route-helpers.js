// @ts-check
/**
 * Helpers compartilhados pelas rotas HTTP de sessões SDK.
 *
 * Este módulo concentra metadata runtime, ownership de sessão e lookup ativo para evitar que cada família de rota
 * remonte payload HTTP de erro/sucesso manualmente.
 */

/**
 * @typedef {import('express').Response} Res
 *
 * @typedef {ReturnType<import('./deps.js').resolveSdkRouteSharedDeps>} SdkRouteDeps
 */

/**
 * @template {Record<string, unknown>} T
 * @param {SdkRouteDeps} routeDeps
 * @param {T} payload
 * @returns {T & {
 *     runtimeId?: string;
 *     requestedRuntimeId?: string | null;
 *     runtimeFound?: boolean;
 *     usedDefaultRuntimeFallback?: boolean;
 * }}
 */
export function withRuntimeMeta(routeDeps, payload) {
    return {
        ...payload,
        ...routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps),
    };
}

/**
 * @template {Record<string, unknown>} T
 * @param {SdkRouteDeps} routeDeps
 * @param {T} payload
 * @param {string} sessionId
 * @returns {ReturnType<typeof withRuntimeMeta>}
 */
export function withSessionRuntimeMeta(routeDeps, payload, sessionId) {
    return withRuntimeMeta(routeDeps, routeDeps.sdkSessionOwnership.attachSdkSessionOwnership(payload, sessionId));
}

/**
 * @param {SdkRouteDeps} routeDeps
 * @param {string} id
 * @param {Res} res
 * @returns {NonNullable<ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>> | null}
 */
export function getActiveSessionEntryOrReply(routeDeps, id, res) {
    const entry = routeDeps.sdkSession.getClientSession(id);
    if (entry) {
        return entry;
    }

    const runtimeEntry = routeDeps.sdkRuntimeSession.resolveAgentSdkActiveSessionEntry(
        routeDeps.requestedRuntimeId ?? routeDeps.runtimeId,
        id,
    );
    if (runtimeEntry) {
        return /** @type {NonNullable<ReturnType<SdkRouteDeps['sdkSession']['getClientSession']>>} */ (
            /** @type {unknown} */ (runtimeEntry)
        );
    }

    res.status(404).json({
        ok: false,
        ...routeDeps.sdkRuntimeProjection.buildRuntimeRouteMetaPayload(routeDeps),
        error: `Sessão "${id}" não está ativa. Use POST /api/sdk/sessions/${id}/resume primeiro.`,
    });
    return null;
}
