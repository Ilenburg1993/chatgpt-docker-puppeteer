// @ts-check
/**
 * src/copilot/config/index.js
 *
 * Barrel de re-exportação para src/copilot/config/. Fornece acesso centralizado aos builders de configuração do SDK.
 *
 * @module copilot/config
 */

export {
    buildAlwaysAliveConfig,
    buildDiagnosticConfig,
    buildFullAccessConfig,
    buildReadOnlyConfig,
} from './session-config.js';

export { MCP_SERVERS, buildMcpConfig, listAvailableMcpServers } from './mcp-servers.js';

export {
    AGENT_GUIDELINES,
    AGENT_IDENTITY,
    AGENT_TONE,
    CODE_CHANGE_RULES,
    ENVIRONMENT_CONTEXT,
    LAST_INSTRUCTIONS,
    SYSTEM_PROMPT_SECTIONS,
    TOOL_EFFICIENCY,
    buildAlwaysAliveSystemMessage,
    buildAppendSystemMessage,
    buildHookContextAppendMessage,
    buildReplaceSystemMessage,
} from './system-prompt.js';

export {
    buildCustomAgentsConfig,
    getCustomAgent,
    listAvailableSdkAgents,
    listCustomAgents,
    registerCustomAgent,
    removeCustomAgent,
} from './custom-agents.js';

export { PinnedFilesLoader } from './pinned-files.js';

export {
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    loadCustomTools,
    registerCustomTool,
    removeCustomTool,
} from '#copilot/sdk/custom-tools';
export { getToolsConfig, loadToolsConfig, patchToolsConfig } from '#copilot/sdk/tools-state';
