// @ts-check
/**
 * src/copilot/tools/experimental-rpc-tools.js
 *
 * Tools que expõem os subsistemas experimentais do SDK RPC para a LLM-B. Permitem ao agente gerenciar fleet, agents,
 * skills, MCP servers, plugins e extensions quando os respectivos feature flags estão habilitados.
 *
 * Ativação: chamar `setExperimentalSession(session)` após a sessão ser criada. As tools verificam internamente se o
 * feature flag está habilitado antes de executar.
 *
 * @module copilot/tools/experimental-rpc-tools
 * @see module:copilot/sdk/experimental-rpc
 * @see module:copilot/sdk/feature-flags
 */

import { COPILOT_RPC_TIMEOUT_MS } from '#copilot/config';
import { TimeoutError, toError } from '#copilot/core';
import { createTool } from '#copilot/sdk';
import { z } from 'zod';
import { log } from './logger.js';
import { withSkipPermission } from './tool-factory.js';

import {
    agentDeselect,
    agentGetCurrent,
    agentList,
    agentReload,
    agentSelect,
    extensionsDisable,
    extensionsEnable,
    extensionsList,
    extensionsReload,
    fleetStart,
    mcpDisable,
    mcpEnable,
    mcpList,
    mcpReload,
    pluginsList,
    skillsDisable,
    skillsEnable,
    skillsList,
    skillsReload,
} from '#copilot/sdk';

// ─── Session handle ──────────────────────────────────────────────────────────

/** @type {import('@github/copilot-sdk').CopilotSession | null} */
let _session = null;

/**
 * Injeta a CopilotSession completa para uso nos experimental tools. Chamar após `initOrResumeSession()`.
 *
 * @param {import('@github/copilot-sdk').CopilotSession | null} session
 */
export function setExperimentalSession(session) {
    _session = session;
    log('DEBUG', `[experimental-rpc-tools] Session ${session ? 'registrada' : 'removida'}.`);
}

/**
 * Retorna a sessão ou lança erro padronizado.
 *
 * @returns {import('@github/copilot-sdk').CopilotSession}
 */
function getSession() {
    if (!_session) throw new Error('Sessão SDK não disponível. Agent não inicializado ou em reconexão.');
    return _session;
}

/**
 * Executa uma operação experimental com tratamento de erros padronizado e timeout.
 *
 * @template T
 * @param {string} toolName
 * @param {(session: import('@github/copilot-sdk').CopilotSession) => Promise<T>} fn
 * @returns {Promise<T | { error: string }>}
 */
async function wrapExp(toolName, fn) {
    let session;
    try {
        session = getSession();
    } catch (e) {
        return { error: toError(e).message };
    }
    try {
        const result = await Promise.race([
            fn(session),
            new Promise((_resolve, reject) =>
                setTimeout(
                    () => reject(new TimeoutError(`Experimental RPC timeout (${COPILOT_RPC_TIMEOUT_MS}ms)`)),
                    COPILOT_RPC_TIMEOUT_MS,
                ),
            ),
        ]);
        return /** @type {T} */ (result);
    } catch (e) {
        log('ERROR', `[${toolName}] ${toError(e).message}`);
        return { error: toError(e).message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fleet tools
// ═══════════════════════════════════════════════════════════════════════════════

const expFleetStartTool = createTool({
    name: 'exp_fleet_start',
    description: '[Experimental] Inicia um fleet de agentes paralelos. ' + 'Requer feature flag "fleet" habilitado.',
    parameters:
        /** @type {import('#copilot/sdk/types').ZodSchema<{ maxAgents?: number; model?: string; prompt?: string }>} */ (
            /** @type {unknown} */ (
                z.object({
                    maxAgents: z.number().optional().describe('Número máximo de agentes no fleet'),
                    model: z.string().optional().describe('Modelo a usar nos agentes do fleet'),
                    prompt: z.string().optional().describe('Prompt usado para os agentes do fleet'),
                })
            )
        ),
    handler: async (/** @type {{ maxAgents?: number; model?: string; prompt?: string }} */ params) =>
        wrapExp('exp_fleet_start', (s) => fleetStart(s, params)),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent tools
// ═══════════════════════════════════════════════════════════════════════════════

const expAgentListTool = createTool({
    name: 'exp_agent_list',
    description: '[Experimental] Lista agentes disponíveis na sessão. ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_list', (s) => agentList(s)),
});

const expAgentGetCurrentTool = createTool({
    name: 'exp_agent_get_current',
    description: '[Experimental] Retorna o agente ativo atual. ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_get_current', (s) => agentGetCurrent(s)),
});

const expAgentSelectTool = createTool({
    name: 'exp_agent_select',
    description: '[Experimental] Seleciona um agente por ID. ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ agentId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                agentId: z.string().min(1).describe('ID do agente a selecionar'),
            })
        )
    ),
    handler: async (/** @type {{ agentId: string }} */ { agentId }) =>
        wrapExp('exp_agent_select', (s) => agentSelect(s, agentId)),
});

const expAgentDeselectTool = createTool({
    name: 'exp_agent_deselect',
    description:
        '[Experimental] Deseleciona o agente ativo (volta ao padrão). ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_deselect', (s) => agentDeselect(s)),
});

const expAgentReloadTool = createTool({
    name: 'exp_agent_reload',
    description: '[Experimental] Recarrega a lista de agentes. ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_reload', (s) => agentReload(s)),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Skills tools
// ═══════════════════════════════════════════════════════════════════════════════

const expSkillsListTool = createTool({
    name: 'exp_skills_list',
    description: '[Experimental] Lista skills disponíveis. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_skills_list', (s) => skillsList(s)),
});

const expSkillsEnableTool = createTool({
    name: 'exp_skills_enable',
    description: '[Experimental] Habilita uma skill por ID. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ skillId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                skillId: z.string().min(1).describe('ID da skill a habilitar'),
            })
        )
    ),
    handler: async (/** @type {{ skillId: string }} */ { skillId }) =>
        wrapExp('exp_skills_enable', (s) => skillsEnable(s, skillId)),
});

const expSkillsDisableTool = createTool({
    name: 'exp_skills_disable',
    description: '[Experimental] Desabilita uma skill por ID. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ skillId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                skillId: z.string().min(1).describe('ID da skill a desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ skillId: string }} */ { skillId }) =>
        wrapExp('exp_skills_disable', (s) => skillsDisable(s, skillId)),
});

const expSkillsReloadTool = createTool({
    name: 'exp_skills_reload',
    description: '[Experimental] Recarrega a lista de skills. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_skills_reload', (s) => skillsReload(s)),
});

// ═══════════════════════════════════════════════════════════════════════════════
// MCP tools
// ═══════════════════════════════════════════════════════════════════════════════

const expMcpListTool = createTool({
    name: 'exp_mcp_list',
    description: '[Experimental] Lista servidores MCP disponíveis. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_mcp_list', (s) => mcpList(s)),
});

const expMcpEnableTool = createTool({
    name: 'exp_mcp_enable',
    description: '[Experimental] Habilita um servidor MCP por ID. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ serverId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                serverId: z.string().min(1).describe('ID do servidor MCP a habilitar'),
            })
        )
    ),
    handler: async (/** @type {{ serverId: string }} */ { serverId }) =>
        wrapExp('exp_mcp_enable', (s) => mcpEnable(s, serverId)),
});

const expMcpDisableTool = createTool({
    name: 'exp_mcp_disable',
    description: '[Experimental] Desabilita um servidor MCP por ID. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ serverId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                serverId: z.string().min(1).describe('ID do servidor MCP a desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ serverId: string }} */ { serverId }) =>
        wrapExp('exp_mcp_disable', (s) => mcpDisable(s, serverId)),
});

const expMcpReloadTool = createTool({
    name: 'exp_mcp_reload',
    description: '[Experimental] Recarrega servidores MCP. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_mcp_reload', (s) => mcpReload(s)),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Plugins tools
// ═══════════════════════════════════════════════════════════════════════════════

const expPluginsListTool = createTool({
    name: 'exp_plugins_list',
    description: '[Experimental] Lista plugins instalados. ' + 'Requer feature flag "plugins" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_plugins_list', (s) => pluginsList(s)),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Extensions tools
// ═══════════════════════════════════════════════════════════════════════════════

const expExtensionsListTool = createTool({
    name: 'exp_extensions_list',
    description: '[Experimental] Lista extensões disponíveis. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_extensions_list', (s) => extensionsList(s)),
});

const expExtensionsEnableTool = createTool({
    name: 'exp_extensions_enable',
    description: '[Experimental] Habilita uma extensão por ID. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ extensionId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                extensionId: z.string().min(1).describe('ID da extensão a habilitar'),
            })
        )
    ),
    handler: async (/** @type {{ extensionId: string }} */ { extensionId }) =>
        wrapExp('exp_extensions_enable', (s) => extensionsEnable(s, extensionId)),
});

const expExtensionsDisableTool = createTool({
    name: 'exp_extensions_disable',
    description: '[Experimental] Desabilita uma extensão por ID. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ extensionId: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                extensionId: z.string().min(1).describe('ID da extensão a desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ extensionId: string }} */ { extensionId }) =>
        wrapExp('exp_extensions_disable', (s) => extensionsDisable(s, extensionId)),
});

const expExtensionsReloadTool = createTool({
    name: 'exp_extensions_reload',
    description: '[Experimental] Recarrega extensões. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_extensions_reload', (s) => extensionsReload(s)),
});

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Tools experimentais de RPC — fleet, agent, skills, mcp, plugins, extensions. Todas as tools read-only são envolvidas
 * com `withSkipPermission`.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const experimentalRpcTools = [
    // Fleet
    expFleetStartTool,
    // Agent
    withSkipPermission(expAgentListTool),
    withSkipPermission(expAgentGetCurrentTool),
    expAgentSelectTool,
    expAgentDeselectTool,
    expAgentReloadTool,
    // Skills
    withSkipPermission(expSkillsListTool),
    expSkillsEnableTool,
    expSkillsDisableTool,
    expSkillsReloadTool,
    // MCP
    withSkipPermission(expMcpListTool),
    expMcpEnableTool,
    expMcpDisableTool,
    expMcpReloadTool,
    // Plugins
    withSkipPermission(expPluginsListTool),
    // Extensions
    withSkipPermission(expExtensionsListTool),
    expExtensionsEnableTool,
    expExtensionsDisableTool,
    expExtensionsReloadTool,
];
