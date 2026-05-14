// @ts-check
/**
 * src/copilot/tools/session/experimental-rpc-tools.js
 *
 * Tools que expõem os subsistemas experimentais do SDK RPC para a LLM-B. Permitem ao agente gerenciar fleet, agents,
 * skills, MCP servers, plugins e extensions quando os respectivos feature flags estão habilitados.
 *
 * Ativação: chamar `setExperimentalSession(session)` após a sessão ser criada. As tools verificam internamente se o
 * feature flag está habilitado antes de executar.
 *
 * @module copilot/tools/session/experimental-rpc-tools
 * @see module:copilot/sdk/experimental-rpc
 * @see module:copilot/sdk/rpc
 * @see module:copilot/sdk/feature-flags
 */

import { COPILOT_RPC_TIMEOUT_MS, MAESTRO_AGENT_NAME } from '#copilot/config';
import { toError } from '#copilot/core';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';

import { agentGetCurrent, agentList, agentReload, agentSelect } from '#copilot/sdk/rpc';

import {
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
} from '#copilot/sdk/experimental-rpc';

// ─── Session handle ──────────────────────────────────────────────────────────

/** @type {import('#copilot/sdk/types').CopilotSession | null} */
let _session = null;

/**
 * Injeta a CopilotSession completa para uso nos experimental tools. Chamar após `initOrResumeSession()`.
 *
 * @param {import('#copilot/sdk/types').CopilotSession | null} session
 */
export function setExperimentalSession(session) {
    _session = session;
    log('DEBUG', `[experimental-rpc-tools] Session ${session ? 'registrada' : 'removida'}.`);
}

/**
 * Retorna a sessão ou lança erro padronizado.
 *
 * @returns {import('#copilot/sdk/types').CopilotSession}
 */
function getSession() {
    if (!_session) throw new Error('Sessão SDK não disponível. Agent não inicializado ou em reconexão.');
    return _session;
}

/**
 * Resolve timeout efetivo para operações experimentais.
 *
 * Retorna sempre `null`: timeouts experimentais da LLM-B são apenas informativos.
 *
 * @param {number | null | undefined} timeoutMs
 * @returns {number | null}
 */
function resolveExperimentalTimeoutMs(timeoutMs) {
    void timeoutMs;
    return null;
}

/**
 * Executa uma operação experimental com tratamento de erros padronizado e timeout.
 *
 * @template T
 * @param {string} toolName
 * @param {(session: import('#copilot/sdk/types').CopilotSession) => Promise<T>} fn
 * @param {{ timeoutMs?: number | null }} [opts]
 * @returns {Promise<T | { error: string }>}
 */
async function wrapExp(toolName, fn, opts = {}) {
    let session;
    try {
        session = getSession();
    } catch (e) {
        return { error: toError(e).message };
    }
    resolveExperimentalTimeoutMs(opts.timeoutMs);
    try {
        log('DEBUG', `[${toolName}] experimentalRpcTimeout=disabled advisory=${COPILOT_RPC_TIMEOUT_MS}ms`);
        const result = await fn(session);
        return /** @type {T} */ (result);
    } catch (e) {
        log('ERROR', `[${toolName}] ${toError(e).message}`);
        return { error: toError(e).message };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fleet tools
// ═══════════════════════════════════════════════════════════════════════════════

const expFleetStartTool = buildTool({
    name: 'exp_fleet_start',
    description: '[Experimental] Inicia um fleet de agentes paralelos. ' + 'Requer feature flag "fleet" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ prompt?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                prompt: z.string().optional().describe('Prompt opcional combinado às instruções do fleet'),
            })
        )
    ),
    handler: async (/** @type {{ prompt?: string }} */ params) =>
        // Fleet bootstrap pode durar mais que RPCs curtas de controle; evitar timeout absoluto aqui.
        wrapExp('exp_fleet_start', (s) => fleetStart(s, params), { timeoutMs: null }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent tools
// ═══════════════════════════════════════════════════════════════════════════════

const expAgentListTool = buildTool({
    name: 'exp_agent_list',
    description: '[Experimental] Lista agentes disponíveis na sessão. ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_list', (s) => agentList(s)),
});

const expAgentGetCurrentTool = buildTool({
    name: 'exp_agent_get_current',
    description: '[Experimental] Retorna o agente ativo atual. ' + 'Requer feature flag "agents" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_get_current', (s) => agentGetCurrent(s)),
});

const expAgentSelectTool = buildTool({
    name: 'exp_agent_select',
    description:
        '[Experimental] Reforça o agente maestro obrigatório. Selecionar outro agente diretamente é bloqueado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ name: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().min(1).describe('Nome do agente a selecionar'),
            })
        )
    ),
    handler: async (/** @type {{ name: string }} */ { name }) => {
        if (name !== MAESTRO_AGENT_NAME) {
            return {
                error: `Seleção direta de "${name}" bloqueada. O agente ativo obrigatório é "${MAESTRO_AGENT_NAME}".`,
                enforcedAgent: MAESTRO_AGENT_NAME,
            };
        }
        return wrapExp('exp_agent_select', (s) => agentSelect(s, MAESTRO_AGENT_NAME));
    },
});

const expAgentDeselectTool = buildTool({
    name: 'exp_agent_deselect',
    description: '[Experimental] Bloqueia deseleção do maestro e reforça agent-full como agente ativo obrigatório.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_agent_deselect', (s) => agentSelect(s, MAESTRO_AGENT_NAME)),
});

const expAgentReloadTool = buildTool({
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

const expSkillsListTool = buildTool({
    name: 'exp_skills_list',
    description: '[Experimental] Lista skills disponíveis. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_skills_list', (s) => skillsList(s)),
});

const expSkillsEnableTool = buildTool({
    name: 'exp_skills_enable',
    description: '[Experimental] Habilita uma skill por nome. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ name: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().min(1).describe('Nome da skill a habilitar'),
            })
        )
    ),
    handler: async (/** @type {{ name: string }} */ { name }) =>
        wrapExp('exp_skills_enable', (s) => skillsEnable(s, name)),
});

const expSkillsDisableTool = buildTool({
    name: 'exp_skills_disable',
    description: '[Experimental] Desabilita uma skill por nome. ' + 'Requer feature flag "skills" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ name: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().min(1).describe('Nome da skill a desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ name: string }} */ { name }) =>
        wrapExp('exp_skills_disable', (s) => skillsDisable(s, name)),
});

const expSkillsReloadTool = buildTool({
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

const expMcpListTool = buildTool({
    name: 'exp_mcp_list',
    description: '[Experimental] Lista servidores MCP disponíveis. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_mcp_list', (s) => mcpList(s)),
});

const expMcpEnableTool = buildTool({
    name: 'exp_mcp_enable',
    description: '[Experimental] Habilita um servidor MCP por nome. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ serverName: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                serverName: z.string().min(1).describe('Nome do servidor MCP a habilitar'),
            })
        )
    ),
    handler: async (/** @type {{ serverName: string }} */ { serverName }) =>
        wrapExp('exp_mcp_enable', (s) => mcpEnable(s, serverName)),
});

const expMcpDisableTool = buildTool({
    name: 'exp_mcp_disable',
    description: '[Experimental] Desabilita um servidor MCP por nome. ' + 'Requer feature flag "mcp" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ serverName: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                serverName: z.string().min(1).describe('Nome do servidor MCP a desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ serverName: string }} */ { serverName }) =>
        wrapExp('exp_mcp_disable', (s) => mcpDisable(s, serverName)),
});

const expMcpReloadTool = buildTool({
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

const expPluginsListTool = buildTool({
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

const expExtensionsListTool = buildTool({
    name: 'exp_extensions_list',
    description: '[Experimental] Lista extensões disponíveis. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => wrapExp('exp_extensions_list', (s) => extensionsList(s)),
});

const expExtensionsEnableTool = buildTool({
    name: 'exp_extensions_enable',
    description: '[Experimental] Habilita uma extensão por ID. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ id: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                id: z.string().min(1).describe('ID source-qualified da extensão a habilitar'),
            })
        )
    ),
    handler: async (/** @type {{ id: string }} */ { id }) =>
        wrapExp('exp_extensions_enable', (s) => extensionsEnable(s, id)),
});

const expExtensionsDisableTool = buildTool({
    name: 'exp_extensions_disable',
    description: '[Experimental] Desabilita uma extensão por ID. ' + 'Requer feature flag "extensions" habilitado.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ id: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                id: z.string().min(1).describe('ID source-qualified da extensão a desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ id: string }} */ { id }) =>
        wrapExp('exp_extensions_disable', (s) => extensionsDisable(s, id)),
});

const expExtensionsReloadTool = buildTool({
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
