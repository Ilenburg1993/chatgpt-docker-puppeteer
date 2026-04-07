// @ts-check
import { ConfigError } from '#copilot/core/errors';
/**
 * src/copilot/lib/agents.js
 *
 * Factory lib para construção de CustomAgentConfig do Copilot SDK. CustomAgents são configurações de agentes
 * especializados registrados em uma sessão SDK que podem usar subconjuntos de ferramentas e prompts customizados.
 *
 * Uso típico: import { createAgent, createReadOnlyAgent } from '#copilot/sdk/agents'; const session = await
 * client.createSession({ customAgents: [createReadOnlyAgent('auditor', 'Analisa código sem modificar')] });
 *
 * @module copilot/lib/agents
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
    'read_file',
    'list_directory',
    'grep_search',
    'file_search',
    'semantic_search',
    'get_errors',
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
 * @param {Record<string, object>} [cfg.mcpServers] - MCP servers específicos deste agente
 * @param {boolean} [cfg.infer=true] - Se disponível para inferência de modelo. Default is `true`
 * @returns {CustomAgentConfig}
 * @throws {ConfigError} Se name ou prompt forem string vazia ou não-string
 * @see createReadOnlyAgent
 */
export function createAgent({ name, prompt, displayName, description, tools, mcpServers, infer }) {
    if (!name || typeof name !== 'string') throw new ConfigError('[lib/agents] createAgent: "name" (string) é obrigatório.');
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
        displayName: opts.displayName,
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
        displayName: opts.displayName,
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
