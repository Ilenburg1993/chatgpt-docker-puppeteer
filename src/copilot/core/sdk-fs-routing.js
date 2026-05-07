// @ts-check
/**
 * Política canônica de roteamento entre superfícies SDK workspace virtual e filesystem local.
 *
 * Esta política NÃO funde domínios. Ela apenas decide o modo operacional recomendado para read/write/search/scan
 * considerando disponibilidade das file-tools canônicas locais e do tooling de workspace SDK.
 *
 * @module copilot/core/sdk-fs-routing
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
 * Lista canônica das file-tools locais necessárias para operar diretamente no FS do repositório.
 *
 * @type {readonly string[]}
 */
export const CANONICAL_LOCAL_FS_TOOL_NAMES = Object.freeze([
    'list_directory',
    'read_file_content',
    'search_in_files',
    'create_file',
    'write_file_content',
    'patch_file',
]);

/**
 * Avalia se os nomes de tools carregados cobrem a superfície canônica de FS local.
 *
 * @param {readonly string[]} toolNames
 * @returns {boolean}
 */
export function hasCanonicalLocalFsTools(toolNames) {
    return CANONICAL_LOCAL_FS_TOOL_NAMES.every((name) => toolNames.includes(name));
}

/**
 * Decide modo de roteamento SDK↔FS a partir da disponibilidade das superfícies.
 *
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
            reason: 'Fallback temporário: file-tools locais indisponíveis; operações devem usar workspace SDK.',
        };
    }

    return {
        canonicalFsReady,
        sdkWorkspaceAvailable,
        mode: 'degraded',
        reason: 'Sem FS canônico e sem workspace SDK; investigar boot/load de tools e sessão.',
    };
}
