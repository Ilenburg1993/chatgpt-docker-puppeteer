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

/**
 * AH.1 — Ferramentas excluídas por padrão em sessões always-alive.
 *
 * @type {readonly string[]}
 */
export const DEFAULT_EXCLUDED_TOOLS = /** @type {readonly string[]} */ (
    Object.freeze(['powershell', 'web_fetch', 'web_search', 'memory'])
);

// ─── Env (variáveis de ambiente e constantes de configuração) ─────────────────
export * from './env.js';

export { buildMcpConfig, listAvailableMcpServers, MCP_SERVERS } from './mcp-servers.js';

export {
    AGENT_GUIDELINES,
    AGENT_IDENTITY,
    AGENT_TONE, buildAlwaysAliveSystemMessage,
    buildAppendSystemMessage,
    buildHookContextAppendMessage,
    buildReplaceSystemMessage, CODE_CHANGE_RULES,
    ENVIRONMENT_CONTEXT,
    LAST_INSTRUCTIONS,
    SYSTEM_PROMPT_SECTIONS,
    TOOL_EFFICIENCY
} from './system-prompt.js';

// ─── Novo módulo modular de system prompt (Faixa I) ──────────────────────────
export {
    buildHookContextMessage,
    buildSystemMessage,
    getMode as getSystemPromptMode,
    setMode as setSystemPromptMode, SECTIONS as SYSTEM_PROMPT_MODULAR_SECTIONS
} from './system-prompt/index.js';

export {
    buildCustomAgentsConfig,
    getCustomAgent,
    listAvailableSdkAgents,
    listCustomAgents,
    registerCustomAgent,
    removeCustomAgent
} from './custom-agents.js';

export { CONTEXT_UTIL_BLOCK_THRESHOLD, CONTEXT_UTIL_WARN_THRESHOLD } from './agent.js';

// ─── Session Config Builder (Faixa C) ────────────────────────────────────────
export { SessionConfigBuilder } from './session-config.js';

// ─── Client Options Builder (Faixa C) ────────────────────────────────────────
export { ClientOptionsBuilder } from './client-options.js';

export { PinnedFilesLoader } from './pinned-files.js';
