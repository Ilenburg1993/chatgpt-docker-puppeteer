// @ts-check
/**
 * Porta de configuração para contratos vindos do SDK.
 *
 * `config/` ainda precisa conhecer alguns defaults e builders expostos pelo SDK vanilla. Concentrar esses imports aqui
 * evita que cada módulo de configuração reabra a mesma fronteira arquitetural.
 *
 * @module copilot/config/sdk-config-port
 * @internal
 */

export {
    BUILTIN_HANDLER_MAP,
    INFINITE_SESSION_DEFAULTS,
    REASONING_EFFORTS,
    SYSTEM_PROMPT_SECTIONS,
    approveAll,
    getCustomToolDefinitions,
    getToolsConfig,
    patchToolsConfig,
    registerCustomTool,
    removeCustomTool,
    validateProviderConfig,
} from '#copilot/sdk';

export { resolvePersistentConfigFile } from '../sdk/persistent-paths.js';
export { ClientOptionsBuilder, buildCopilotClientOptionsFromEnv } from '#copilot/sdk/session';

/**
 * @typedef {import('#copilot/sdk/types').SessionConfig} SessionConfig
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
 * @typedef {import('#copilot/sdk/types').SectionOverrideAction} SectionOverrideAction
 */
