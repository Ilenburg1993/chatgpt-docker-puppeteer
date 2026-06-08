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
 * Ferramentas excluídas por padrão em sessões always-alive.
 *
 * Política canônica A.10: nenhuma tool é excluída a priori. Exclusões devem ser decididas dinamicamente em runtime por
 * usuário/operador/LLM.
 *
 * @type {readonly string[]}
 */
export const DEFAULT_EXCLUDED_TOOLS = /** @type {readonly string[]} */ (Object.freeze([]));

// ─── Env (variáveis de ambiente e constantes de configuração) ─────────────────
export * from './env.js';
export { resolveHubTurnTimeout } from './hub-timeout-policy.js';

export { MCP_SERVERS, buildMcpConfig, listAvailableMcpServers } from './mcp-servers.js';

export {
    AGENT_GUIDELINES,
    AGENT_IDENTITY,
    AGENT_TONE,
    CODE_CHANGE_RULES,
    ENVIRONMENT_CONTEXT,
    LAST_INSTRUCTIONS,
    SYSTEM_MESSAGE_SECTIONS,
    SYSTEM_PROMPT_SECTIONS,
    TOOL_EFFICIENCY,
    buildAlwaysAliveSystemMessage,
    buildAppendSystemMessage,
    buildHookContextAppendMessage,
    buildHookContextMessage,
    buildLiveSystemMessage,
    buildReplaceSystemMessage,
    buildSystemMessage,
    buildSystemPromptBindingSnapshot,
    buildSystemPromptProfile,
    buildSystemPromptPublicProjection,
    evaluateSystemPromptFreshness,
    getSystemPromptSdkCompatibility,
    readResolvedSystemPromptUserConfig,
    readResolvedSystemPromptUserConfigSync,
    readSessionInstructionSources,
    readSystemPromptStatus,
    readSystemPromptStatusSync,
} from './system-prompt/index.js';

// ─── Novo módulo modular de system prompt (Faixa I) ──────────────────────────
export {
    SYSTEM_PROMPT_CONFIG_PATH,
    SYSTEM_PROMPT_DEFAULT_COLLABORATION_CONTRACT,
    SYSTEM_PROMPT_DEFAULT_ENGINEERING_DOCTRINE,
    SYSTEM_PROMPT_DEFAULT_EVOLUTION_LOOP,
    SYSTEM_PROMPT_DEFAULT_FOCUS_PATHS,
    SYSTEM_PROMPT_DEFAULT_MODE,
    SYSTEM_PROMPT_DEFAULT_NORTH_STAR,
    SYSTEM_PROMPT_DEFAULT_OBJECTIVE,
    SYSTEM_PROMPT_DEFAULT_PERSONALITY,
    SYSTEM_PROMPT_DEFAULT_RELOAD_STRATEGY,
    SECTIONS as SYSTEM_PROMPT_MODULAR_SECTIONS,
    getSystemPromptConfigFilePath,
    getMode as getSystemPromptMode,
    normalizeSystemPromptMode,
    normalizeSystemPromptReloadStrategy,
    readSystemPromptModeState,
    readUserAppendContent,
    readUserAppendContentSync,
    renderSystemPromptProfileBlock,
    resetMode as resetSystemPromptMode,
    setMode as setSystemPromptMode,
} from './system-prompt/index.js';

export {
    MAESTRO_AGENT_NAME,
    buildCustomAgentsConfig,
    getCustomAgent,
    getEffectiveSdkAgentSelection,
    listAvailableSdkAgents,
    listCustomAgents,
    registerCustomAgent,
    removeCustomAgent,
} from './custom-agents.js';

export {
    OPERATIONAL_PROFILES,
    loadOperationalProfile,
    resolveOperationalAgentSelection,
} from './operational-profiles.js';
export { listTerminalSdkCommandSpecs } from './terminal-sdk-command-specs.js';

export {
    TOOL_ALIASES,
    getAllToolNames,
    normalizeAgentToolList,
    normalizeObservedToolName,
    resolveToolName,
} from './tool-aliases.js';

export {
    CONTEXT_UTIL_BLOCK_THRESHOLD,
    CONTEXT_UTIL_WARN_THRESHOLD,
    DEFAULT_COPILOT_MODEL,
    DEFAULT_COPILOT_REASONING_EFFORT,
} from './agent.js';

// ─── Session Config Builder (Faixa C) ────────────────────────────────────────
export { ResumeSessionConfigBuilder } from './resume-session-config.js';
export { RESUME_SESSION_CONFIG_KEYS, SessionConfigBuilder, sanitizeResumeSessionConfig } from './session-config.js';

// ─── Client Options Builder (Faixa C) ────────────────────────────────────────
export { ClientOptionsBuilder, buildCopilotClientOptionsFromEnv } from './client-options.js';
export {
    BYOK_ENV_KEYS,
    BYOK_SECRET_ENV_KEYS,
    buildConfiguredByokModelListHandler,
    discoverConfiguredByokModelsFromEnv,
    readConfiguredByokModelDiscoveryCacheFromEnv,
    readConfiguredByokModelsFromEnv,
    readConfiguredByokProfileSummaries,
    readConfiguredByokProfilesFromEnv,
    readConfiguredByokState,
    readConfiguredByokSummary,
    redactProviderConfig,
    resolveConfiguredByokSessionOverrides,
} from './byok.js';

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
