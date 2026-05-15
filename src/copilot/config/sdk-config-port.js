// @ts-check
/**
 * Porta leve de configuração para contratos vindos do SDK.
 *
 * `system-prompt/` precisa conhecer seções vanilla do SDK sem abrir o barrel raiz. Este port permanece deliberadamente
 * pequeno para não carregar tools, client ou runtime ao importar configuração de texto.
 *
 * @module copilot/config/sdk-config-port
 * @internal
 */

export {
    INFINITE_SESSION_DEFAULTS,
    REASONING_EFFORTS,
} from '#copilot/sdk/constants';

export {
    ClientOptionsBuilder,
    appendSystemMessage,
    approveAll,
    buildCopilotClientOptionsFromEnv,
    customizeSystemMessage,
    getSectionDescription,
    getSectionNames,
    replaceSystemMessage,
    sectionOverride,
    SYSTEM_PROMPT_SECTIONS,
    supportsCustomizeMode,
    validateProviderConfig,
} from '#copilot/sdk/session';

export { resolvePersistentConfigFile } from '../sdk/persistent-paths.js';

export { instructionSourcesGet } from '#copilot/sdk/rpc';

export {
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    getToolsConfig,
    patchToolsConfig,
    registerCustomTool,
    removeCustomTool,
} from '#copilot/sdk/tools';

/**
 * @typedef {import('#copilot/sdk/types').SessionConfig} SessionConfig
 *
 * @typedef {import('#copilot/sdk/types').CopilotSession} CopilotSession
 *
 * @typedef {import('#copilot/sdk/types').ResumeSessionConfig} ResumeSessionConfig
 *
 * @typedef {import('#copilot/sdk/types').PermissionHandler} PermissionHandler
 *
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 *
 * @typedef {import('#copilot/sdk/types').SystemMessageConfig} SystemMessageConfig
 *
 * @typedef {import('#copilot/sdk/types').MCPServerConfig} MCPServerConfig
 *
 * @typedef {import('#copilot/sdk/types').CustomAgentConfig} CustomAgentConfig
 *
 * @typedef {import('#copilot/sdk/types').DefaultAgentConfig} DefaultAgentConfig
 *
 * @typedef {import('#copilot/sdk/types').InfiniteSessionConfig} InfiniteSessionConfig
 *
 * @typedef {import('#copilot/sdk/types').CommandDefinition} CommandDefinition
 *
 * @typedef {import('#copilot/sdk/types').ElicitationHandler} ElicitationHandler
 *
 * @typedef {import('#copilot/sdk/types').ModelCapabilitiesOverride} ModelCapabilitiesOverride
 *
 * @typedef {import('#copilot/sdk/types').SessionEventHandler} SessionEventHandler
 *
 * @typedef {import('#copilot/sdk/types').CreateSessionFsHandler} CreateSessionFsHandler
 *
 * @typedef {import('#copilot/sdk/types').ProviderConfig} ProviderConfig
 *
 * @typedef {import('#copilot/sdk/types').SectionOverrideAction} SectionOverrideAction
 */
