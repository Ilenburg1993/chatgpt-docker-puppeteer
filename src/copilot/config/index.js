// @ts-check
/**
 * src/copilot/config/index.js
 *
 * Barrel de re-exportação para src/copilot/config/. Fornece acesso centralizado aos builders de configuração do SDK.
 *
 * @module copilot/config
 * @see EventBus
 */

// Profile builders (buildAlwaysAliveConfig etc.) movidos para '#copilot/hooks/presets/profiles'.
// Cf. PARTE-21C Faixa H: eliminação de violações L2→L3.
export { DEFAULT_EXCLUDED_TOOLS } from './session-config.js';

// ─── Env (variáveis de ambiente e constantes de configuração) ─────────────────
export * from './env.js';

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
