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
 * Built-ins legadas de FS do SDK/CLI que competem com a nossa superfície canônica local.
 *
 * Elas continuam úteis como compatibilidade em runtimes antigos, mas numa sessão LLM-B SDK-first do projeto elas devem
 * ficar fora da superfície de escolha do modelo sempre que `CANONICAL_LOCAL_FS_TOOL_NAMES` estiver disponível. A
 * execução real deve passar por `src/copilot/tools/file/*`, onde ficam política de path, I/O engine, auditoria e
 * metadados `io`.
 *
 * @type {readonly string[]}
 */
export const LEGACY_SDK_LOCAL_FS_TOOL_NAMES = Object.freeze(['view', 'glob']);

/**
 * Nomes legados que existiram em superfícies antigas do CLI, mas que modelos/SDKs recentes frequentemente reportam como
 * desconhecidos em `excludedTools`. Eles ficam documentados para auditoria e troubleshooting, sem serem enviados por
 * padrão para evitar warnings de configuração a cada turno.
 *
 * @type {readonly string[]}
 */
export const COMPAT_SDK_LOCAL_FS_TOOL_NAMES = Object.freeze(['grep', 'create', 'edit']);

/**
 * Superfície canônica local para execução de comandos.
 *
 * @type {readonly string[]}
 */
export const CANONICAL_LOCAL_EXEC_TOOL_NAMES = Object.freeze(['exec_command']);

/**
 * Built-ins legadas de shell do SDK/CLI.
 *
 * @type {readonly string[]}
 */
export const LEGACY_SDK_SHELL_TOOL_NAMES = Object.freeze(['bash', 'write_bash', 'read_bash', 'stop_bash']);

/**
 * Constrói a denylist de superfície de sessão para privilegiar FS local canônico sem remover handlers internos.
 *
 * @param {readonly string[]} toolNames
 * @param {readonly string[]} [baseExcluded=[]] Default is `[]`
 * @returns {string[]}
 */
export function buildCanonicalLocalSurfaceExcludedTools(toolNames, baseExcluded = []) {
    const excluded = new Set(baseExcluded);
    if (hasCanonicalLocalFsTools(toolNames)) {
        for (const name of LEGACY_SDK_LOCAL_FS_TOOL_NAMES) excluded.add(name);
    }
    if (hasCanonicalLocalExecTools(toolNames)) {
        for (const name of LEGACY_SDK_SHELL_TOOL_NAMES) excluded.add(name);
    }
    return [...excluded].sort();
}

/**
 * Backward-compatible alias para chamadas legadas.
 *
 * @param {readonly string[]} toolNames
 * @param {readonly string[]} [baseExcluded=[]] Default is `[]`
 * @returns {string[]}
 */
export function buildCanonicalLocalFsExcludedTools(toolNames, baseExcluded = []) {
    return buildCanonicalLocalSurfaceExcludedTools(toolNames, baseExcluded);
}

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
 * Avalia se a superfície canônica de execução local está disponível.
 *
 * @param {readonly string[]} toolNames
 * @returns {boolean}
 */
export function hasCanonicalLocalExecTools(toolNames) {
    return CANONICAL_LOCAL_EXEC_TOOL_NAMES.every((name) => toolNames.includes(name));
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
