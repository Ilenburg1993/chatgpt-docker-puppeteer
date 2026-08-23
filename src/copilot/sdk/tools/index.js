// @ts-check
/**
 * src/copilot/sdk/tools/index.js — Barrel de `sdk/tools/`
 *
 * Ponto de entrada único para todos os módulos de ferramentas SDK. Consumidores externos DEVEM importar via
 * `#copilot/sdk/tools`, nunca via caminhos relativos profundos (`../../sdk/tools/registry.js` etc.).
 *
 * @module copilot/sdk/tools
 */

export { AgentToolPolicy } from './agent-policy.js';
export { TOOL_NAME_RE, sanitizeToolNames, validateToolDefinitionContract } from './contracts.js';
export {
    CANONICAL_LOCAL_EXEC_TOOL_NAMES,
    CANONICAL_LOCAL_FS_TOOL_NAMES,
    SDK_LOCAL_FS_TOOL_NAMES,
    SDK_SHELL_TOOL_NAMES,
    buildCanonicalLocalSurfaceExcludedTools,
    hasCanonicalLocalExecTools,
    hasCanonicalLocalFsTools,
} from './local-surface-policy.js';

export {
    BuiltInTools,
    ToolSet,
    convertMcpCallToolResult,
    createDeclarationTool,
    createTool,
    createToolSync,
    defineTool,
    normalizeToolParametersSchema,
    normalizeToolTelemetry,
} from './core.js';

export {
    BUILTIN_HANDLER_MAP,
    _resetRegistry,
    buildCustomTools,
    getCustomToolDefinitions,
    initCustomTools,
    loadCustomToolsAsync,
    registerCustomTool,
    removeCustomTool,
    setCustomToolsBuilder,
} from './custom.js';

export {
    createRegistry,
    createToolRegistryAdapter,
    excludeByNames,
    filterByNames,
    getAllTools,
    getReadOnlyTools,
    getToolByName,
    getToolCount,
    getToolsBy,
    getToolsByCategory,
    getToolsByTag,
    hasToolByName,
    inspectRegistry,
    listToolNames,
    mergeRegistries,
    registerTool,
    registerTools,
} from './registry.js';

export { getToolsConfig, loadToolsConfigAsync, patchToolsConfig, resetToolsConfigForTests } from './state.js';
