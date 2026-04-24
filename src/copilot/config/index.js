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
 * Mantido localmente neste barrel porque há contratos estruturais que validam a superfície pública de
 * `#copilot/config`.
 *
 * @type {readonly string[]}
 */
export const DEFAULT_EXCLUDED_TOOLS = /** @type {readonly string[]} */ (
    Object.freeze(['powershell', 'web_fetch', 'web_search', 'memory'])
);

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
} from './system-prompt/index.js';

// ─── Novo módulo modular de system prompt (Faixa I) ──────────────────────────
export {
    SECTIONS as SYSTEM_PROMPT_MODULAR_SECTIONS,
    buildHookContextMessage,
    buildSystemMessage,
    getMode as getSystemPromptMode,
    setMode as setSystemPromptMode,
} from './system-prompt/index.js';

export {
    buildCustomAgentsConfig,
    getCustomAgent,
    listAvailableSdkAgents,
    listCustomAgents,
    registerCustomAgent,
    removeCustomAgent,
} from './custom-agents.js';

export {
    CONTEXT_UTIL_BLOCK_THRESHOLD,
    CONTEXT_UTIL_WARN_THRESHOLD,
    DEFAULT_COPILOT_MODEL,
    DEFAULT_COPILOT_REASONING_EFFORT,
} from './agent.js';

// ─── Session Config Builder (Faixa C) ────────────────────────────────────────
export { SessionConfigBuilder } from './session-config.js';

// ─── Client Options Builder (Faixa C) ────────────────────────────────────────
export { ClientOptionsBuilder } from './client-options.js';

export { PinnedFilesLoader } from './pinned-files.js';

export {
    readDeclarativeCustomToolsConfig,
    readDeclarativeToolsConfig,
    readSkillsConfig,
    registerDeclarativeCustomToolConfig,
    removeDeclarativeCustomToolConfig,
    updateDeclarativeToolsConfig,
    updateSkillsConfig,
    writeSkillsConfig,
} from './declarative-runtime-config.js';
