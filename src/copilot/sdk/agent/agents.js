// @ts-check
import { ConfigError } from '#copilot/core';
import {
    agentDeselect as rpcAgentDeselect,
    agentGetCurrent as rpcAgentGetCurrent,
    agentList as rpcAgentList,
    agentReload as rpcAgentReload,
    agentSelect as rpcAgentSelect,
} from '../rpc/ops.js';
/**
 * src/copilot/sdk/agents.js
 *
 * Factory lib para construcao de CustomAgentConfig do Copilot SDK + funcoes RPC de runtime para listagem,
 * selecao/deselecao e reload de agents em sessao ativa.
 *
 * Uso tipico: import { createAgent, createReadOnlyAgent, listAgents } from '#copilot/sdk'; const session = await
 * client.createSession({ customAgents: [createReadOnlyAgent('auditor', 'Analisa codigo')] }); const { agents } = await
 * listAgents(session);
 *
 * @module copilot/sdk/agents
 * @see EventBus
 */

/**
 * @typedef {import('@github/copilot-sdk').CustomAgentConfig} CustomAgentConfig
 */

// ─── Ferramentas somente-leitura canônicas do SDK ────────────────────────────

/**
 * Lista canônica de ferramentas de leitura do SDK Copilot. Apropriada para agentes que precisam inspecionar o workspace
 * sem modificar.
 *
 * @type {string[]}
 */
export const READ_ONLY_TOOLS = [
    'read_file_content',
    'list_directory',
    'search_in_files',
    'workspace_symbol_search',
    'workspace_index_search',
    'workspace_index_find_symbol',
    'workspace_scope_context',
    'workspace_scope_find_symbol',
    'workspace_scope_list',
    'git_status',
    'git_diff',
    'git_changed_files',
    'git_log',
    'get_system_health',
];

// ─── Factory principal ────────────────────────────────────────────────────────

/**
 * Cria uma configuração de agente customizado para o SDK Copilot.
 *
 * @example
 *     const agent = createAgent({
 *         name: 'reviewer',
 *         prompt: 'Você é um revisor de código.',
 *         tools: ['read_file', 'grep_search'],
 *     });
 *
 * @param {object} cfg
 * @param {string} cfg.name - Nome único do agente (obrigatório)
 * @param {string} cfg.prompt - Prompt de instrução do agente (obrigatório)
 * @param {string} [cfg.displayName] - Nome de exibição para UI
 * @param {string} [cfg.description] - Descrição do que o agente faz
 * @param {string[] | null} [cfg.tools] - Lista de nomes de ferramentas. null = todas. undefined = todas.
 * @param {Record<string, import('@github/copilot-sdk').MCPServerConfig>} [cfg.mcpServers] - MCP servers específicos
 *   deste agente
 * @param {boolean} [cfg.infer=true] - Se disponível para inferência de modelo. Default is `true`
 * @param {string[]} [cfg.skills] - Skills a pré-carregar no contexto do agente
 * @returns {CustomAgentConfig}
 * @throws {ConfigError} Se name ou prompt forem string vazia ou não-string
 * @see createReadOnlyAgent
 */
export function createAgent({ name, prompt, displayName, description, tools, mcpServers, infer, skills }) {
    if (!name || typeof name !== 'string')
        throw new ConfigError('[lib/agents] createAgent: "name" (string) é obrigatório.');
    if (!prompt || typeof prompt !== 'string')
        throw new ConfigError('[lib/agents] createAgent: "prompt" (string) é obrigatório.');

    /** @type {CustomAgentConfig} */
    const config = { name, prompt };

    if (displayName !== undefined) config.displayName = displayName;
    if (description !== undefined) config.description = description;
    if (tools !== undefined) config.tools = tools;
    if (mcpServers !== undefined)
        config.mcpServers = /** @type {Record<string, import('@github/copilot-sdk').MCPServerConfig>} */ (mcpServers);
    if (infer !== undefined) config.infer = infer;
    if (skills !== undefined) config.skills = skills;

    return config;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

/**
 * Cria um agente com acesso somente-leitura ao workspace. Usa READ_ONLY_TOOLS como base, podendo adicionar ferramentas
 * extras.
 *
 * @param {string} name - Nome único do agente
 * @param {string} prompt - Instrução do agente
 * @param {object} [opts={}] Default is `{}`
 * @param {string} [opts.displayName]
 * @param {string} [opts.description]
 * @param {string[]} [opts.extraTools=[]] - Ferramentas adicionais além das de leitura. Default is `[]`
 * @returns {CustomAgentConfig}
 */
export function createReadOnlyAgent(name, prompt, opts = {}) {
    const tools = opts.extraTools ? [...READ_ONLY_TOOLS, ...opts.extraTools] : [...READ_ONLY_TOOLS];
    return createAgent({
        name,
        prompt,
        ...(opts.displayName === undefined ? {} : { displayName: opts.displayName }),
        description: opts.description ?? 'Agente somente-leitura — não modifica arquivos.',
        tools,
    });
}

/**
 * Cria um agente com acesso irrestrito a todas as ferramentas disponíveis.
 *
 * @param {string} name - Nome único do agente
 * @param {string} prompt - Instrução do agente
 * @param {object} [opts={}] Default is `{}`
 * @param {string} [opts.displayName]
 * @param {string} [opts.description]
 * @returns {CustomAgentConfig}
 */
export function createFullAccessAgent(name, prompt, opts = {}) {
    return createAgent({
        name,
        prompt,
        ...(opts.displayName === undefined ? {} : { displayName: opts.displayName }),
        description: opts.description ?? 'Agente com acesso irrestrito a todas as ferramentas.',
        tools: null, // null = todas as ferramentas
    });
}

/**
 * Cria um agente especializado em análise estática sem execução de comandos. Usa READ_ONLY_TOOLS sem ferramentas de
 * execução de terminal.
 *
 * @param {string} name - Nome único do agente
 * @param {string} prompt - Instrução do agente
 * @param {object} [opts={}] Default is `{}`
 * @param {string} [opts.displayName]
 * @returns {CustomAgentConfig}
 */
export function createAnalystAgent(name, prompt, opts = {}) {
    return createAgent({
        name,
        prompt,
        displayName: opts.displayName ?? name,
        description: 'Agente analista — inspeciona código e relatórios sem execução.',
        tools: READ_ONLY_TOOLS,
    });
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

/**
 * Constrói um array de CustomAgentConfig a partir de uma lista de objetos de configuração. Útil para montar o campo
 * `customAgents` da SessionConfig com múltiplos agentes.
 *
 * @param {...CustomAgentConfig} agents
 * @returns {CustomAgentConfig[]}
 */
export function buildAgentList(...agents) {
    return agents;
}

/**
 * Verifica se um nome de agente é válido (não vazio, sem espaços, somente alfanumérico e hífen).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidAgentName(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/.test(name);
}

/**
 * Filtra uma lista de agentes retornando apenas os habilitados para inferência.
 *
 * @param {CustomAgentConfig[]} agents
 * @returns {CustomAgentConfig[]}
 */
export function filterInferableAgents(agents) {
    return agents.filter((a) => a.infer !== false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Faixa 15 - Agent Runtime Management (via wrappers canônicos de RPC)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * @typedef {{ name: string; displayName: string; description: string }} AgentInfo
 */

/**
 * Lista todos os agents customizados disponiveis na sessao.
 *
 * @param {CopilotSession} session - Sessao ativa com RPC
 * @returns {Promise<{ agents: AgentInfo[] }>} Lista de agents
 */
export async function listAgents(session) {
    return rpcAgentList(session);
}

/**
 * Retorna o agent customizado atualmente selecionado, ou null se usando agent padrao.
 *
 * @param {CopilotSession} session - Sessao ativa com RPC
 * @returns {Promise<{ agent: AgentInfo | null }>} Agent atual ou null
 */
export async function getCurrentAgent(session) {
    return rpcAgentGetCurrent(session);
}

/**
 * Seleciona um agent customizado na sessao pelo nome.
 *
 * @param {CopilotSession} session - Sessao ativa com RPC
 * @param {string} name - Nome unico do agent a selecionar
 * @returns {Promise<{ agent: AgentInfo }>} Agent selecionado
 * @throws {TypeError} Se name nao for string nao-vazia
 */
export async function selectAgent(session, name) {
    return rpcAgentSelect(session, name);
}

/**
 * Remove selecao de agent customizado, revertendo para o agent padrao.
 *
 * @param {CopilotSession} session - Sessao ativa com RPC
 * @returns {Promise<{}>} Resultado vazio (deselect nao retorna dados)
 */
export async function deselectAgent(session) {
    return rpcAgentDeselect(session);
}

/**
 * Recarrega a lista de agents customizados da sessao.
 *
 * @param {CopilotSession} session - Sessao ativa com RPC
 * @returns {Promise<{ agents: AgentInfo[] }>} Lista atualizada de agents
 */
export async function reloadAgents(session) {
    return rpcAgentReload(session);
}
