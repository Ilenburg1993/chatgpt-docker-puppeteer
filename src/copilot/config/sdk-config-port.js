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
} from '#copilot/sdk';
