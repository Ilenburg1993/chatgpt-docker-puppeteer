// @ts-check
/**
 * Presentation-owned decision for choosing the visible filesystem route.
 *
 * SDK Tools owns capability/surface membership. Presentation owns how those capabilities are projected into an
 * operator-facing routing decision.
 *
 * @module copilot/presentation/files/routing
 */

/** @typedef {'local-fs-primary' | 'sdk-workspace-only' | 'degraded'} SdkFsRoutingMode */
/**
 * @typedef {object} SdkFsRoutingDecision
 * @property {boolean} canonicalFsReady
 * @property {boolean} sdkWorkspaceAvailable
 * @property {SdkFsRoutingMode} mode
 * @property {string} reason
 */

/**
 * @param {{ canonicalFsReady: boolean; sdkWorkspaceAvailable: boolean }} input
 * @returns {SdkFsRoutingDecision}
 */
export function decideSdkFsRouting(input) {
    const canonicalFsReady = input.canonicalFsReady === true;
    const sdkWorkspaceAvailable = input.sdkWorkspaceAvailable === true;
    if (canonicalFsReady) {
        return {
            canonicalFsReady,
            sdkWorkspaceAvailable,
            mode: 'local-fs-primary',
            reason: 'FS local canônico disponível; SDK workspace é superfície auxiliar/virtual.',
        };
    }
    if (sdkWorkspaceAvailable) {
        return {
            canonicalFsReady,
            sdkWorkspaceAvailable,
            mode: 'sdk-workspace-only',
            reason: 'File-tools locais indisponíveis; operações de arquivo devem usar workspace SDK.',
        };
    }
    return {
        canonicalFsReady,
        sdkWorkspaceAvailable,
        mode: 'degraded',
        reason: 'Sem FS canônico e sem workspace SDK; investigar boot/load de tools e sessão.',
    };
}

/**
 * @param {{ canonicalFsReady: boolean; sdkWorkspaceAvailable: boolean }} input
 * @returns {SdkFsRoutingDecision}
 */
export function buildRuntimeSdkFsRoutingProjection(input) {
    return decideSdkFsRouting(input);
}
